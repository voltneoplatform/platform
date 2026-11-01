import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  OPEN_AGREEMENT_STATES,
  dueNow,
  type AgreementState,
  type DriverLanguage,
  type TicketCategory,
} from '@voltneo/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileLinks } from '../files/file-storage';
import { AgreementsService } from '../agreements/agreements.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentLinksService } from '../payments/payment-links.service';
import { TicketsService } from '../tickets/tickets.service';
import { AutopayService } from '../autopay/autopay.service';
import type { AuthenticatedDriver, RequestMeta } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import { dateOnly } from '../common/util';

const include = {
  planVersion: { include: { plan: true } },
  batteryType: true,
  battery: true,
  vehicle: true,
  instalments: { orderBy: { sequence: 'asc' } },
  lateFees: true,
} satisfies Prisma.AgreementInclude;
type Loaded = Prisma.AgreementGetPayload<{ include: typeof include }>;

/** States the driver sees: everything signed and not cancelled. */
const HIDDEN: AgreementState[] = ['DRAFT', 'CANCELLED'];

/**
 * The Driver App's view of the backend (M6, spec: GET /me/agreement, /me/dues,
 * POST /me/payments/intent, GET /me/receipts, POST /me/tickets). A driver sees
 * only their own agreements, payments and service requests.
 */
@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: FileLinks,
    private readonly agreements: AgreementsService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentLinks: PaymentLinksService,
    private readonly tickets: TicketsService,
    private readonly autopay: AutopayService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async profile(me: AuthenticatedDriver) {
    const d = await this.prisma.driver.findUniqueOrThrow({
      where: { id: me.id },
      include: {
        agreements: {
          where: { state: { notIn: HIDDEN } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, state: true },
        },
      },
    });
    return {
      driver: {
        id: d.id,
        name: d.name,
        phone: d.phone,
        email: d.email,
        language: d.language as DriverLanguage,
      },
      agreements: d.agreements,
    };
  }

  /** The driver changes their language or email in the app. */
  async update(
    me: AuthenticatedDriver,
    dto: { language?: DriverLanguage; email?: string | null },
    meta: RequestMeta,
  ) {
    const before = await this.prisma.driver.findUniqueOrThrow({ where: { id: me.id } });
    const data: { language?: DriverLanguage; email?: string | null } = {};
    if (dto.language && dto.language !== before.language) data.language = dto.language;
    if (dto.email !== undefined && dto.email !== before.email) data.email = dto.email;
    if (Object.keys(data).length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.driver.update({ where: { id: me.id }, data });
        await this.audit.record(
          {
            actorType: 'DRIVER',
            actorId: me.id,
            action: 'driver.update',
            tableName: 'drivers',
            recordId: me.id,
            before: Object.fromEntries(
              Object.keys(data).map((k) => [k, before[k as keyof typeof data]]),
            ),
            after: { ...data, via: 'driver_app' },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
      });
    }
    return this.profile(me);
  }

  /** The agreement asked for, or the driver's current one (open first, then the newest). */
  private async load(me: AuthenticatedDriver, id?: string): Promise<Loaded> {
    if (id) {
      const a = await this.prisma.agreement.findUnique({ where: { id }, include });
      if (!a || a.driverId !== me.id || HIDDEN.includes(a.state as AgreementState)) {
        throw new NotFoundException('Agreement not found');
      }
      return a;
    }
    const rows = await this.prisma.agreement.findMany({
      where: { driverId: me.id, state: { notIn: HIDDEN } },
      include,
      orderBy: { createdAt: 'desc' },
    });
    const open = rows.find((r) => (OPEN_AGREEMENT_STATES as readonly string[]).includes(r.state));
    const a = open ?? rows[0];
    if (!a) throw new NotFoundException('You have no agreement yet');
    return a;
  }

  private due(a: Loaded) {
    return dueNow({
      state: a.state as AgreementState,
      lines: a.instalments.map((i) => ({
        sequence: i.sequence,
        dueDate: dateOnly(i.dueDate)!,
        amount: i.amount,
        amountPaid: i.amountPaid,
      })),
      lateFeesDue: a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0),
      today: this.clock.today(),
    });
  }

  /** AutoPay as the driver sees it, and the charge waiting for the instalment now due, if any. */
  private async autopayFor(a: Loaded) {
    const v = await this.autopay.view(a.id);
    const waiting = await this.autopay.scheduledFor(a.id);
    const m = v.mandate && ['PENDING', 'ACTIVE'].includes(v.mandate.status) ? v.mandate : null;
    return {
      available: v.available,
      unavailableReason: v.unavailableReason,
      methods: v.methods,
      method: m?.method ?? null,
      status: m?.status ?? 'OFF',
      maxAmount: m?.maxAmount ?? a.instalment,
      approvalUrl: m?.approvalUrl ?? null,
      nextCharge: waiting
        ? { amount: waiting.amount, date: dateOnly(waiting.scheduledFor), status: waiting.status }
        : null,
    };
  }

  /** True when AutoPay will take the instalment the driver would otherwise pay now. */
  private coveredByAutopay(
    due: ReturnType<MeService['due']>,
    next: { date: string | null } | null,
  ) {
    return (
      !!next && (due.kind === 'UPCOMING' || due.kind === 'DUE_TODAY') && next.date === due.dueDate
    );
  }

  async agreement(me: AuthenticatedDriver, id?: string) {
    const a = await this.load(me, id);
    const autopay = await this.autopayFor(a);
    const due = this.due(a);
    const lang = me.language;
    const plan = a.planVersion.plan;
    const paid = a.instalments.reduce((s, i) => s + i.amountPaid, 0);
    const lateFeesDue = a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
    return {
      id: a.id,
      number: a.number,
      state: a.state,
      signedAt: a.signedAt,
      activatedAt: a.activatedAt,
      plan: {
        code: plan.code,
        name: lang === 'BN' ? plan.nameBn : lang === 'HI' ? plan.nameHi : plan.nameEn,
      },
      battery: {
        type: a.batteryType.name,
        serial: a.battery?.serial ?? null,
      },
      vehicle: { registration: a.vehicle.registration, type: a.vehicle.type },
      money: {
        downPayment: a.downPayment,
        instalment: a.instalment,
        termMonths: a.termMonths,
        totalPayable: a.totalPayable,
        paid,
        outstanding: a.totalPayable - paid,
        lateFeesDue,
        instalmentsPaid: a.instalments.filter((i) => i.sequence > 0 && i.status === 'PAID').length,
        dueDay: a.dueDay,
      },
      due,
      /** AutoPay takes this instalment on its Due Date: the app shows that instead of Pay. */
      dueByAutopay: this.coveredByAutopay(due, autopay.nextCharge),
      autopay,
      schedule: a.instalments.map((i) => ({
        sequence: i.sequence,
        dueDate: dateOnly(i.dueDate),
        amount: i.amount,
        amountPaid: i.amountPaid,
        status: i.status,
      })),
      documents: { signedCopy: Boolean(a.signedFileKey) },
    };
  }

  /** Pay exactly what is due now (founder, 31 Oct 2026): a UPI link the app opens. */
  async pay(me: AuthenticatedDriver, agreementId: string, meta: RequestMeta) {
    const a = await this.load(me, agreementId);
    const due = this.due(a);
    if (due.amount <= 0) {
      throw new UnprocessableEntityException({
        message: 'Nothing is due to pay right now',
        code: 'NOTHING_DUE',
        due,
      });
    }
    const waiting = await this.autopay.scheduledFor(a.id);
    if (this.coveredByAutopay(due, waiting ? { date: dateOnly(waiting.scheduledFor) } : null)) {
      throw new ConflictException({
        message: 'UPI AutoPay will take this instalment on its Due Date',
        code: 'AUTOPAY_SCHEDULED',
      });
    }
    const link = await this.paymentLinks.forDriver(a.id, me.id, due.amount, meta);
    return { url: link.url, amount: link.amount, expiresAt: link.expiresAt, due };
  }

  async startAutopay(
    me: AuthenticatedDriver,
    agreementId: string,
    meta: RequestMeta,
    method: 'UPI' | 'ENACH',
  ) {
    const a = await this.load(me, agreementId);
    return this.autopay.start(a.id, { type: 'DRIVER', id: me.id }, meta, method);
  }

  async stopAutopay(me: AuthenticatedDriver, agreementId: string, meta: RequestMeta) {
    const a = await this.load(me, agreementId);
    await this.autopay.cancel(a.id, { type: 'DRIVER', id: me.id }, meta);
    return this.agreement(me, a.id);
  }

  async payments(me: AuthenticatedDriver) {
    const rows = await this.prisma.payment.findMany({
      where: { driverId: me.id },
      include: { agreement: { select: { number: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    return rows.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      agreementNumber: p.agreement.number,
      amount: p.amount,
      method: p.method,
      receivedAt: p.receivedAt,
      balanceAfter: p.balanceAfter,
    }));
  }

  async receipt(me: AuthenticatedDriver, paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.driverId !== me.id) throw new NotFoundException('Receipt not found');
    return this.paymentsService.receipt(paymentId, me.language);
  }

  /** Key Facts (Schedule 5) or the payment schedule (Schedule 1), in the driver's language. */
  async document(me: AuthenticatedDriver, agreementId: string, doc: 'schedule-1' | 'schedule-5') {
    const a = await this.load(me, agreementId);
    return this.agreements.document(a.id, doc, me.language);
  }

  /** A short-lived link to the signed agreement (clause F11: "a copy in the App"). */
  async signedCopy(me: AuthenticatedDriver, agreementId: string, meta: RequestMeta) {
    const a = await this.load(me, agreementId);
    if (!a.signedFileKey) throw new NotFoundException('The signed copy is not uploaded yet');
    await this.audit.record({
      actorType: 'DRIVER',
      actorId: me.id,
      action: 'agreement.signed_copy.view',
      tableName: 'agreements',
      recordId: a.id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    // The corrected agreement, if the battery changed after signing.
    const latest = await this.prisma.agreementResigning.findFirst({
      where: { agreementId: a.id },
      orderBy: { recordedAt: 'desc' },
    });
    if (latest) return this.links.issue(latest.fileKey, latest.fileType, latest.fileName);
    return this.links.issue(
      a.signedFileKey,
      a.signedFileType ?? 'application/pdf',
      a.signedFileName ?? `${a.number}-signed.pdf`,
    );
  }

  async ticketList(me: AuthenticatedDriver) {
    const rows = await this.prisma.serviceTicket.findMany({
      where: { driverId: me.id },
      include: { agreement: { select: { number: true } } },
      orderBy: { reportedAt: 'desc' },
      take: 100,
    });
    return rows.map((t) => ({
      id: t.id,
      number: t.number,
      agreementNumber: t.agreement.number,
      category: t.category,
      description: t.description,
      status: t.status,
      reportedAt: t.reportedAt,
      dueBy: t.dueBy,
      resolvedAt: t.resolvedAt,
    }));
  }

  async reportFault(
    me: AuthenticatedDriver,
    input: { agreementId: string; category: TicketCategory; description: string },
    meta: RequestMeta,
  ) {
    const a = await this.load(me, input.agreementId);
    const open = await this.prisma.serviceTicket.findFirst({
      where: { agreementId: a.id, status: { in: ['OPEN', 'ASSIGNED', 'CLOSE_REQUESTED'] } },
    });
    if (open) {
      throw new ConflictException({
        message: `Request ${open.number} for this battery is still open. A technician will contact you.`,
        code: 'TICKET_OPEN',
        ticket: open.number,
      });
    }
    await this.tickets.createFromDriver(me.id, { ...input, agreementId: a.id }, meta);
    return this.ticketList(me);
  }
}
