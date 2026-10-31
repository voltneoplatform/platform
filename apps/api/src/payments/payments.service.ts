import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PAYABLE_STATES,
  PAYMENT_METHOD_LABELS,
  completionState,
  financialYear,
  formatRupees,
  hasPermission,
  paymentJournal,
  receiptNumber,
  type AgreementState,
  type DueItem,
  type PaymentMethod,
  type PaymentSource,
} from '@voltneo/shared';
import { allocatePayment } from '@voltneo/shared';
import type { Prisma } from '../generated/prisma/client';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import { DocumentsService } from '../documents/documents.service';
import { TEXTS, docDate } from '../documents/texts';
import { CollectionsService } from '../collections/collections.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { nextCounter } from '../common/counters';
import { dateOnly, istDate, isUniqueViolation, serializable, type Tx } from '../common/util';
import type { ListPaymentsQuery, RecordPaymentDto } from './dto';

export interface ApplyPaymentInput {
  agreementId: string;
  amount: number;
  method: PaymentMethod;
  source: PaymentSource;
  provider?: string | null;
  providerRef?: string | null;
  reference?: string | null;
  collectedById?: string | null;
  recordedById?: string | null;
  clientRequestId?: string | null;
  note?: string | null;
  receivedAt: Date;
  /** Gateway money cannot be refused; manual entries above the balance are. */
  allowExcess: boolean;
  actor: {
    type: 'STAFF' | 'SYSTEM';
    id: string | null;
    ip?: string | null;
    requestId?: string | null;
  };
}

const paymentInclude = {
  agreement: { select: { id: true, number: true, state: true } },
  driver: { select: { id: true, name: true, phone: true, language: true } },
  allocations: {
    include: {
      instalment: { select: { sequence: true, dueDate: true } },
      lateFee: { select: { accrualDate: true } },
    },
  },
  messages: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PaymentInclude;

type PaymentFull = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

function istDay(d: Date): string {
  return docDate(istDate(d));
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly documents: DocumentsService,
    private readonly collections: CollectionsService,
  ) {}

  onModuleInit() {
    // Emailed receipts carry the receipt PDF in the driver's language.
    this.messaging.registerEmail('payment_receipt', async (row) => {
      const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId! } });
      const lang = row.language as DriverLanguage;
      const { pdf, fileName } = await this.receipt(p.id, lang);
      return {
        subject: TEXTS[lang].receiptEmailSubject(p.receiptNumber),
        attachment: { filename: fileName, contentType: 'application/pdf', content: pdf },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Applying a payment (shared by manual entry and gateway webhooks)
  // ---------------------------------------------------------------------------

  /**
   * Allocates a payment (late fees first, then the oldest unpaid instalment;
   * clause B10), issues the next receipt number, posts the ledger journal,
   * moves the agreement on when the down payment or the last instalment is
   * paid, and queues the receipt message. Runs inside the caller's transaction.
   */
  async apply(tx: Tx, input: ApplyPaymentInput): Promise<{ paymentId: string; messageId: string }> {
    const a = await tx.agreement.findUnique({
      where: { id: input.agreementId },
      include: {
        driver: true,
        instalments: { orderBy: { sequence: 'asc' } },
        lateFees: { orderBy: { accrualDate: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!(PAYABLE_STATES as readonly string[]).includes(a.state)) {
      throw new ConflictException(
        a.state === 'AWAITING_INSTALLATION'
          ? 'The down payment is complete; instalments can be paid once the battery is installed'
          : 'This agreement cannot take payments in its current state',
      );
    }

    const beforeInstallation = a.state === 'AWAITING_DOWN_PAYMENT';
    const dues: DueItem[] = [
      ...a.lateFees.map((f) => ({
        kind: 'LATE_FEE' as const,
        id: f.id,
        outstanding: f.amount - f.amountPaid,
        order: dateOnly(f.accrualDate)!,
      })),
      ...a.instalments
        .filter((i) => !beforeInstallation || i.sequence === 0)
        .map((i) => ({
          kind: i.sequence === 0 ? ('DOWN_PAYMENT' as const) : ('INSTALMENT' as const),
          id: i.id,
          outstanding: i.amount - i.amountPaid,
          order: i.sequence,
        })),
    ];
    const { allocations, excess } = allocatePayment(input.amount, dues);
    if (excess > 0 && !input.allowExcess) {
      const owed = input.amount - excess;
      throw new UnprocessableEntityException({
        message: beforeInstallation
          ? `Only the down payment can be paid before installation: ${formatRupees(owed)} is still due`
          : `That is more than the ${formatRupees(owed)} still owed on this agreement`,
        code: 'OVERPAYMENT',
        outstanding: owed,
      });
    }

    const fy = financialYear(istDate());
    const receipt = receiptNumber(fy, await nextCounter(tx, `receipt:${fy}`));

    const paidById = new Map(a.instalments.map((i) => [i.id, i.amountPaid]));
    for (const al of allocations) {
      if (al.kind === 'LATE_FEE') {
        await tx.lateFeeAccrual.update({
          where: { id: al.id },
          data: { amountPaid: { increment: al.amount } },
        });
        continue;
      }
      const inst = a.instalments.find((i) => i.id === al.id)!;
      const paid = inst.amountPaid + al.amount;
      paidById.set(inst.id, paid);
      await tx.instalment.update({
        where: { id: inst.id },
        data: {
          amountPaid: paid,
          status: paid === inst.amount ? 'PAID' : 'PART_PAID',
          paidAt: paid === inst.amount ? input.receivedAt : null,
        },
      });
    }
    const paidTotal = [...paidById.values()].reduce((s, v) => s + v, 0);
    const balanceAfter = a.totalPayable - paidTotal;

    const payment = await tx.payment.create({
      data: {
        receiptNumber: receipt,
        agreementId: a.id,
        driverId: a.driverId,
        amount: input.amount,
        excess,
        balanceAfter,
        method: input.method,
        source: input.source,
        provider: input.provider ?? null,
        providerRef: input.providerRef ?? null,
        reference: input.reference ?? null,
        collectedById: input.collectedById ?? null,
        recordedById: input.recordedById ?? null,
        clientRequestId: input.clientRequestId ?? null,
        note: input.note ?? null,
        receivedAt: input.receivedAt,
        allocations: {
          create: [
            ...allocations.map((al) => ({
              kind: al.kind,
              instalmentId: al.kind === 'LATE_FEE' ? null : al.id,
              lateFeeId: al.kind === 'LATE_FEE' ? al.id : null,
              amount: al.amount,
            })),
            ...(excess > 0 ? [{ kind: 'EXCESS' as const, amount: excess }] : []),
          ],
        },
      },
    });

    const lines = paymentJournal({
      method: input.method,
      source: input.source,
      allocations,
      excess,
    });
    await tx.ledgerJournal.create({
      data: {
        kind: 'PAYMENT',
        memo: `Receipt ${receipt} for agreement ${a.number}`,
        paymentId: payment.id,
        createdById: input.actor.id,
        entries: {
          create: lines.map((l) => ({
            account: l.account,
            agreementId: a.id,
            staffId: l.account === 'CASH_WITH_AGENTS' ? (input.collectedById ?? null) : null,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });

    // State changes driven by money.
    let to: AgreementState | null = null;
    let event = '';
    const dp = a.instalments.find((i) => i.sequence === 0);
    if (beforeInstallation && dp && paidById.get(dp.id) === dp.amount) {
      to = 'AWAITING_INSTALLATION';
      event = 'DOWN_PAYMENT_RECEIVED';
    } else if (!beforeInstallation && a.instalments.every((i) => paidById.get(i.id) === i.amount)) {
      to = completionState(
        istDate(input.receivedAt),
        a.instalments.filter((i) => i.dueDate).map((i) => dateOnly(i.dueDate)!),
      );
      event = to;
    }
    if (to) {
      await tx.agreement.update({
        where: { id: a.id },
        data: { state: to, ...(to === 'AWAITING_INSTALLATION' ? {} : { completedAt: new Date() }) },
      });
      await tx.agreementEvent.create({
        data: {
          agreementId: a.id,
          event,
          fromState: a.state,
          toState: to,
          reason: `Receipt ${receipt}`,
          actorType: input.actor.type,
          actorId: input.actor.id,
        },
      });
    }

    // Overdue cleared: end the late spell, restore task, cancel open requests (M3).
    await this.collections.afterPayment(tx, a.id, input.actor);

    const lang = a.driver.language as DriverLanguage;
    const messageId = await this.messaging.queue(tx, {
      driverId: a.driverId,
      toPhone: a.driver.phone,
      channel: 'SMS',
      template: 'payment_receipt',
      language: lang,
      body: TEXTS[lang].receiptSms({
        amount: formatRupees(input.amount),
        agreement: a.number,
        date: istDay(input.receivedAt),
        receipt,
        balance: formatRupees(balanceAfter),
      }),
      paymentId: payment.id,
      agreementId: a.id,
    });
    // The receipt also goes by email when the driver gave one (founder, 31 Oct 2026).
    if (a.driver.email) {
      await this.messaging.queue(tx, {
        driverId: a.driverId,
        toPhone: a.driver.phone,
        toEmail: a.driver.email,
        channel: 'EMAIL',
        template: 'payment_receipt',
        language: lang,
        body: `${TEXTS[lang].receiptSms({
          amount: formatRupees(input.amount),
          agreement: a.number,
          date: istDay(input.receivedAt),
          receipt,
          balance: formatRupees(balanceAfter),
        })}\n\n${TEXTS[lang].receiptEmailNote}`,
        paymentId: payment.id,
        agreementId: a.id,
      });
    }

    await this.audit.record(
      {
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: 'payment.record',
        tableName: 'payments',
        recordId: payment.id,
        after: { ...payment, allocations, agreementStateChange: to },
        ip: input.actor.ip ?? null,
        requestId: input.actor.requestId ?? null,
      },
      tx,
    );
    return { paymentId: payment.id, messageId };
  }

  // ---------------------------------------------------------------------------
  // Manual entry
  // ---------------------------------------------------------------------------

  async record(dto: RecordPaymentDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const canRecord = hasPermission(actor.role, 'payments.record');
    const canCollect = hasPermission(actor.role, 'payments.collect_cash');
    let collectedById: string | null = null;
    if (dto.method === 'CASH') {
      if (!canCollect) throw new ForbiddenException('Your role does not allow collecting cash');
      collectedById = dto.collectedById ?? actor.id;
      if (collectedById !== actor.id && !canRecord) {
        throw new ForbiddenException('You can only record cash you collected yourself');
      }
    } else {
      if (!canRecord) throw new ForbiddenException('Your role does not allow recording payments');
      if (!dto.reference) {
        throw new BadRequestException('Enter the UPI transaction ID (UTR) or card approval code');
      }
      if (dto.collectedById) {
        throw new BadRequestException('Only cash payments name a collecting agent');
      }
    }
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (receivedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('The payment time cannot be in the future');
    }

    if (dto.clientRequestId) {
      const existing = await this.prisma.payment.findUnique({
        where: { clientRequestId: dto.clientRequestId },
      });
      if (existing) return this.repeated(existing, dto);
    }

    let result: { paymentId: string; messageId: string };
    try {
      result = await serializable(this.prisma, async (tx) => {
        const a = await tx.agreement.findUnique({ where: { id: dto.agreementId } });
        if (!a) throw new NotFoundException('Agreement not found');
        if (a.signedAt && receivedAt.getTime() < a.signedAt.getTime() - 60_000) {
          throw new BadRequestException('The payment time is before the agreement was signed');
        }
        if (collectedById) {
          const agent = await tx.staffUser.findUnique({ where: { id: collectedById } });
          if (
            !agent ||
            agent.status !== 'ACTIVE' ||
            !hasPermission(agent.role, 'payments.collect_cash')
          ) {
            throw new BadRequestException('Choose an active staff member who may collect cash');
          }
        }
        return this.apply(tx, {
          agreementId: dto.agreementId,
          amount: dto.amountPaise,
          method: dto.method,
          source: 'MANUAL',
          reference: dto.reference ? dto.reference.toUpperCase() : null,
          collectedById,
          recordedById: actor.id,
          clientRequestId: dto.clientRequestId ?? null,
          note: dto.note ?? null,
          receivedAt,
          allowExcess: false,
          actor: { type: 'STAFF', id: actor.id, ip: meta.ip, requestId: meta.requestId },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const target = JSON.stringify(err.meta ?? {});
        if (dto.clientRequestId && target.includes('client_request_id')) {
          const existing = await this.prisma.payment.findUnique({
            where: { clientRequestId: dto.clientRequestId },
          });
          if (existing) return this.repeated(existing, dto);
        }
        throw new ConflictException('A payment with this reference has already been entered');
      }
      throw err;
    }
    await this.messaging.deliver([result.messageId]);
    return this.get(result.paymentId);
  }

  private async repeated(
    existing: { id: string; agreementId: string; amount: number },
    dto: RecordPaymentDto,
  ) {
    if (existing.agreementId !== dto.agreementId || existing.amount !== dto.amountPaise) {
      throw new ConflictException('This request ID was already used for a different payment');
    }
    return { ...(await this.get(existing.id)), repeated: true };
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    const rows = unique.length
      ? await this.prisma.staffUser.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private view(p: PaymentFull, names: Map<string, string>) {
    return {
      id: p.id,
      receiptNumber: p.receiptNumber,
      agreement: { id: p.agreement.id, number: p.agreement.number, state: p.agreement.state },
      driver: { id: p.driver.id, name: p.driver.name, phone: p.driver.phone },
      amount: p.amount,
      excess: p.excess,
      balanceAfter: p.balanceAfter,
      method: p.method,
      source: p.source,
      provider: p.provider,
      providerRef: p.providerRef,
      reference: p.reference,
      collectedById: p.collectedById,
      collectedByName: p.collectedById ? (names.get(p.collectedById) ?? null) : null,
      recordedByName: p.recordedById ? (names.get(p.recordedById) ?? null) : null,
      note: p.note,
      receivedAt: p.receivedAt,
      createdAt: p.createdAt,
      allocations: p.allocations
        .map((a) => ({
          kind: a.kind,
          amount: a.amount,
          sequence: a.instalment?.sequence ?? null,
          dueDate: dateOnly(a.instalment?.dueDate),
          lateFeeDate: dateOnly(a.lateFee?.accrualDate),
        }))
        .sort((x, y) => {
          const rank = { LATE_FEE: 0, DOWN_PAYMENT: 1, INSTALMENT: 2, EXCESS: 3 } as const;
          return rank[x.kind] - rank[y.kind] || (x.sequence ?? 0) - (y.sequence ?? 0);
        }),
      messages: p.messages.map((m) => ({
        id: m.id,
        channel: m.channel,
        to: m.channel === 'EMAIL' ? m.toEmail : m.toPhone,
        status: m.status,
        error: m.error,
        createdAt: m.createdAt,
        sentAt: m.sentAt,
      })),
    };
  }

  async get(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw new NotFoundException('Payment not found');
    return this.view(p, await this.names([p.collectedById, p.recordedById]));
  }

  async list(q: ListPaymentsQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const s = q.search?.trim();
    const where: Prisma.PaymentWhereInput = {
      agreementId: q.agreementId,
      method: q.method,
      collectedById: q.collectedById,
      receivedAt:
        q.from || q.to
          ? {
              gte: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined,
              lt: q.to
                ? new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000)
                : undefined,
            }
          : undefined,
      OR: s
        ? [
            { receiptNumber: { contains: s, mode: 'insensitive' } },
            { reference: { contains: s, mode: 'insensitive' } },
            { agreement: { number: { contains: s, mode: 'insensitive' } } },
            { driver: { name: { contains: s, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [total, rows, sum] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);
    const names = await this.names(rows.flatMap((r) => [r.collectedById, r.recordedById]));
    return {
      total,
      page,
      limit,
      totalAmount: sum._sum.amount ?? 0,
      items: rows.map((r) => this.view(r, names)),
    };
  }

  async receipt(id: string, lang: DriverLanguage | undefined) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p) throw new NotFoundException('Payment not found');
    const names = await this.names([p.collectedById]);
    const language = lang ?? (p.driver.language as DriverLanguage);
    const v = this.view(p, names);
    const pdf = await this.documents.receipt(
      {
        receiptNumber: p.receiptNumber,
        receivedAt: p.receivedAt,
        agreementNumber: p.agreement.number,
        driverName: p.driver.name,
        amount: p.amount,
        method: PAYMENT_METHOD_LABELS[p.method],
        reference: p.reference ?? p.providerRef,
        collectedByName: v.collectedByName,
        allocations: v.allocations.map((a) => ({
          kind: a.kind,
          amount: a.amount,
          sequence: a.sequence,
          date: a.kind === 'LATE_FEE' ? a.lateFeeDate : a.dueDate,
        })),
        balanceAfter: p.balanceAfter,
      },
      language,
    );
    return { pdf, fileName: `receipt-${p.receiptNumber.replace(/\//g, '-')}.pdf` };
  }

  /** Sends the receipt message again (for example after a delivery failure). */
  async resendReceipt(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        messages: { where: { channel: { not: 'EMAIL' } }, orderBy: { createdAt: 'desc' }, take: 1 },
        driver: true,
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    const last = p.messages[0];
    if (!last) throw new NotFoundException('This payment has no receipt message');
    const messageId = await this.prisma.$transaction(async (tx) => {
      const mid = await this.messaging.queue(tx, {
        driverId: p.driverId,
        toPhone: p.driver.phone,
        channel: last.channel,
        template: last.template,
        language: last.language,
        body: last.body,
        paymentId: p.id,
        agreementId: p.agreementId,
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'payment.receipt.resend',
          tableName: 'payments',
          recordId: p.id,
          after: { messageId: mid, to: p.driver.phone },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return mid;
    });
    await this.messaging.deliver([messageId]);
    return this.get(id);
  }
}
