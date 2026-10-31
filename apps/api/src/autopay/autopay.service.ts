import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { addDays, addMonths, daysBetween, formatRupees } from '@voltneo/shared';
import type { AutopayCharge, AutopayMandate, Prisma } from '../generated/prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import type { RequestMeta } from '../common/decorators';
import { dateOnly } from '../common/util';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/gateway';
import { newShortCode } from '../payments/payment-links.service';
import { WebhooksService } from '../payments/webhooks.service';
import { mandateStatusFor } from '../payments/autopay-status';

/** UPI AutoPay limit without extra authentication (NPCI; Cashfree FAQ). */
export const UPI_AUTOPAY_LIMIT_PAISE = 15_000_00;
/** Charges are raised this many days before the Due Date at most (Cashfree allows T+1 to T+14). */
export const AUTOPAY_LEAD_DAYS = 3;
/** States in which AutoPay can be switched on and charges are raised. */
const AUTOPAY_STATES = ['AWAITING_INSTALLATION', 'ACTIVE', 'IN_GRACE', 'IMMOBILISED'];
const CHARGE_STATES = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];

export type Actor =
  { type: 'DRIVER'; id: string } | { type: 'STAFF'; id: string } | { type: 'SYSTEM'; id: null };

/**
 * UPI AutoPay (M6 part 2; founder 31 Oct 2026: "pay now + AutoPay now"). The
 * driver approves a mandate for up to one instalment in their UPI app; a few
 * days before each Due Date Volt Neo asks the gateway to take that instalment
 * on the Due Date (the UPI app tells the driver the day before). A charge for
 * an instalment already paid another way is cancelled. Overdue amounts and
 * late fees are never taken by AutoPay: the driver pays those in the app.
 */
@Injectable()
export class AutopayService {
  private readonly logger = new Logger(AutopayService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  private base(): string {
    return this.config.publicApiUrl ?? `http://localhost:${this.config.port}`;
  }

  pageUrl(m: Pick<AutopayMandate, 'shortCode'>): string {
    return `${this.base()}/autopay/${m.shortCode}`;
  }

  /** Why AutoPay cannot be offered on this server, or null. */
  unavailable(): string | null {
    if (!this.gateway.autopayMode) return 'AutoPay is not set up on this server yet';
    return null;
  }

  /** Cashfree needs an email on each mandate: the driver's, else Volt Neo's (T118). */
  private mandateEmail(driverEmail: string | null): string | null {
    if (driverEmail) return driverEmail;
    if (this.config.autopayCustomerEmail) return this.config.autopayCustomerEmail;
    return this.gateway.name === 'fake' ? 'autopay@voltneo.test' : null;
  }

  private chargeView(c: AutopayCharge) {
    return {
      id: c.id,
      amount: c.amount,
      scheduledFor: dateOnly(c.scheduledFor),
      status: c.status,
      failureReason: c.failureReason,
      paymentId: c.paymentId,
      createdAt: c.createdAt,
    };
  }

  /** The agreement's AutoPay: the latest mandate and its recent charges. */
  async view(agreementId: string) {
    const a = await this.prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!a) throw new NotFoundException('Agreement not found');
    let m = await this.prisma.autopayMandate.findFirst({
      where: { agreementId },
      orderBy: { createdAt: 'desc' },
      include: { charges: { orderBy: { scheduledFor: 'desc' }, take: 12 } },
    });
    if (m?.status === 'PENDING') {
      await this.refresh(m);
      m = await this.prisma.autopayMandate.findUnique({
        where: { id: m.id },
        include: { charges: { orderBy: { scheduledFor: 'desc' }, take: 12 } },
      });
    }
    const why =
      this.unavailable() ??
      (!AUTOPAY_STATES.includes(a.state)
        ? 'AutoPay is available only while instalments are being paid'
        : null);
    const upiWhy =
      a.instalment > UPI_AUTOPAY_LIMIT_PAISE
        ? `UPI AutoPay works for instalments up to ${formatRupees(UPI_AUTOPAY_LIMIT_PAISE)}; use e-NACH`
        : null;
    return {
      available: why === null,
      unavailableReason: why,
      /** Which ways of AutoPay this agreement can use: UPI (up to ₹15,000) and e-NACH. */
      methods: {
        UPI: { available: why === null && upiWhy === null, reason: why ?? upiWhy },
        ENACH: { available: why === null, reason: why },
      },
      /** The pretend gateway: head office can simulate approval and charges. */
      canSimulate: this.gateway.name === 'fake',
      mandate: m
        ? {
            id: m.id,
            method: m.method,
            status: m.status,
            gatewayStatus: m.gatewayStatus,
            maxAmount: m.maxAmount,
            statusNote: m.statusNote,
            createdAt: m.createdAt,
            activatedAt: m.activatedAt,
            endedAt: m.endedAt,
            endedBy: m.endedBy,
            approvalUrl: m.status === 'PENDING' ? this.pageUrl(m) : null,
            charges: m.charges.map((c) => this.chargeView(c)),
          }
        : null,
    };
  }

  /** Asks the gateway about a mandate still waiting for the driver's approval. */
  private async refresh(m: AutopayMandate) {
    try {
      const status = await this.gateway.mandateStatus(m.subscriptionId);
      await this.prisma.$transaction((tx) =>
        this.webhooks.mandateEvent(tx, m.subscriptionId, status),
      );
    } catch (err) {
      this.logger.warn(`Could not check AutoPay ${m.subscriptionId}: ${(err as Error).message}`);
    }
  }

  /**
   * Starts a mandate for the agreement and returns the approval page. A mandate
   * still waiting for approval is replaced, so the driver always gets a fresh page.
   */
  async start(
    agreementId: string,
    actor: Actor,
    meta: RequestMeta,
    method: 'UPI' | 'ENACH' = 'UPI',
  ) {
    const why = this.unavailable();
    if (why) throw new ServiceUnavailableException(why);
    const a = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      include: { driver: true, instalments: { orderBy: { sequence: 'desc' }, take: 1 } },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (actor.type === 'DRIVER' && a.driverId !== actor.id) {
      throw new NotFoundException('Agreement not found');
    }
    if (!AUTOPAY_STATES.includes(a.state)) {
      throw new ConflictException('AutoPay is available only while instalments are being paid');
    }
    if (method === 'UPI' && a.instalment > UPI_AUTOPAY_LIMIT_PAISE) {
      throw new UnprocessableEntityException(
        `UPI AutoPay works for instalments up to ${formatRupees(UPI_AUTOPAY_LIMIT_PAISE)}; use e-NACH`,
      );
    }
    const email = this.mandateEmail(a.driver.email);
    if (!email) {
      throw new ServiceUnavailableException(
        "AutoPay needs an email address: add the driver's email, or set AUTOPAY_CUSTOMER_EMAIL",
      );
    }
    const live = await this.prisma.autopayMandate.findFirst({
      where: { agreementId, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    if (live?.status === 'PENDING') await this.refresh(live);
    const still = live
      ? await this.prisma.autopayMandate.findUnique({ where: { id: live.id } })
      : null;
    if (still?.status === 'ACTIVE') throw new ConflictException('AutoPay is already on');
    if (still?.status === 'PENDING') {
      await this.prisma.autopayMandate.updateMany({
        where: { id: still.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          endedAt: this.clock.now(),
          endedBy: 'SYSTEM',
          statusNote: 'Replaced by a new approval request',
        },
      });
    }

    const last = a.instalments[0];
    const expiresAt = new Date(
      `${addMonths(last ? dateOnly(last.dueDate)! : this.clock.today(), 1)}T18:29:59.000Z`,
    );
    const subscriptionId = `VNM_${a.number}_${randomBytes(4).toString('hex')}`;
    const shortCode = newShortCode();
    const created = await this.gateway.createMandate({
      subscriptionId,
      customer: {
        phone: a.driver.phone,
        name: a.driver.name,
        email,
      },
      maxAmountPaise: a.instalment,
      method,
      agreementNumber: a.number,
      expiresAt,
      returnUrl: `${this.base()}/autopay/${shortCode}/done`,
    });
    const m = await this.prisma.$transaction(async (tx) => {
      const row = await tx.autopayMandate.create({
        data: {
          agreementId: a.id,
          driverId: a.driverId,
          subscriptionId,
          gateway: this.gateway.name,
          gatewayRef: created.gatewayRef,
          sessionId: created.sessionId,
          shortCode,
          maxAmount: a.instalment,
          method,
          gatewayStatus: 'INITIALIZED',
        },
      });
      await this.audit.record(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: 'autopay.start',
          tableName: 'autopay_mandates',
          recordId: row.id,
          after: { agreementId: a.id, subscriptionId, maxAmount: a.instalment, method },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return row;
    });
    return { url: this.pageUrl(m), mandateId: m.id };
  }

  /** Switches AutoPay off: the mandate is cancelled at the gateway with any waiting charges. */
  async cancel(agreementId: string, actor: Actor, meta: RequestMeta, reason?: string) {
    const m = await this.prisma.autopayMandate.findFirst({
      where: { agreementId, status: { in: ['PENDING', 'ACTIVE'] } },
      include: { charges: { where: { status: { in: ['SCHEDULED', 'NOTIFIED'] } } } },
    });
    if (!m || (actor.type === 'DRIVER' && m.driverId !== actor.id)) {
      throw new NotFoundException('AutoPay is not on for this agreement');
    }
    // Founder, 31 Oct 2026: once AutoPay or e-NACH is registered, the driver cannot
    // switch it off in the Driver App; only head office can. A request not yet
    // approved can still be withdrawn.
    if (actor.type === 'DRIVER' && m.status === 'ACTIVE') {
      throw new ForbiddenException({
        message: 'AutoPay can be switched off only by Volt Neo head office',
        code: 'AUTOPAY_LOCKED',
      });
    }
    for (const c of m.charges) {
      await this.gateway.cancelCharge(m.subscriptionId, c.chargeId).catch((e: Error) => {
        this.logger.warn(`Could not cancel AutoPay charge ${c.chargeId}: ${e.message}`);
      });
    }
    if (m.status === 'ACTIVE') await this.gateway.cancelMandate(m.subscriptionId);
    else {
      await this.gateway.cancelMandate(m.subscriptionId).catch(() => undefined);
    }
    const endedBy = actor.type === 'DRIVER' ? 'DRIVER' : actor.type;
    await this.prisma.$transaction(async (tx) => {
      await tx.autopayMandate.update({
        where: { id: m.id },
        data: {
          status: 'CANCELLED',
          endedAt: this.clock.now(),
          endedBy,
          statusNote: reason ?? null,
        },
      });
      await tx.autopayCharge.updateMany({
        where: { mandateId: m.id, status: { in: ['SCHEDULED', 'NOTIFIED'] } },
        data: { status: 'CANCELLED', failureReason: 'AutoPay switched off' },
      });
      await this.audit.record(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: 'autopay.cancel',
          tableName: 'autopay_mandates',
          recordId: m.id,
          after: { agreementId, reason: reason ?? null },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.view(agreementId);
  }

  /** The charge waiting for this instalment, if any (the app then hides Pay for it). */
  async scheduledFor(agreementId: string) {
    return this.prisma.autopayCharge.findFirst({
      where: {
        agreementId,
        status: { in: ['SCHEDULED', 'NOTIFIED'] },
        mandate: { status: 'ACTIVE' },
      },
      orderBy: { scheduledFor: 'asc' },
    });
  }

  /**
   * The daily AutoPay run (10:00 India time): ends mandates of agreements that
   * no longer take instalments, cancels charges for instalments already paid,
   * and raises a charge for each instalment due in the next AUTOPAY_LEAD_DAYS.
   */
  async runDaily(today = this.clock.today()) {
    const result = { mandatesEnded: 0, chargesCancelled: 0, chargesRaised: 0, chargesFailed: 0 };

    const active = await this.prisma.autopayMandate.findMany({
      where: { status: 'ACTIVE' },
      include: { agreement: true },
    });
    for (const m of active) {
      if (!AUTOPAY_STATES.includes(m.agreement.state)) {
        try {
          await this.cancel(
            m.agreementId,
            { type: 'SYSTEM', id: null },
            { ip: null, userAgent: null, requestId: null },
            `Agreement ${m.agreement.state.toLowerCase().replace(/_/g, ' ')}`,
          );
          result.mandatesEnded++;
        } catch (err) {
          this.logger.warn(`Could not end AutoPay ${m.subscriptionId}: ${(err as Error).message}`);
        }
      }
    }

    const waiting = await this.prisma.autopayCharge.findMany({
      where: { status: { in: ['SCHEDULED', 'NOTIFIED'] } },
      include: { instalment: true, mandate: true },
    });
    for (const c of waiting) {
      if (c.instalment.status !== 'PAID') continue;
      try {
        await this.gateway.cancelCharge(c.mandate.subscriptionId, c.chargeId);
      } catch (err) {
        this.logger.warn(
          `Could not cancel AutoPay charge ${c.chargeId}: ${(err as Error).message}`,
        );
        continue;
      }
      await this.prisma.autopayCharge.updateMany({
        where: { id: c.id, status: { in: ['SCHEDULED', 'NOTIFIED'] } },
        data: { status: 'CANCELLED', failureReason: 'Instalment already paid another way' },
      });
      result.chargesCancelled++;
    }

    const due = await this.prisma.instalment.findMany({
      where: {
        sequence: { gt: 0 },
        status: { not: 'PAID' },
        dueDate: {
          gte: new Date(`${addDays(today, 1)}T00:00:00.000Z`),
          lte: new Date(`${addDays(today, AUTOPAY_LEAD_DAYS)}T00:00:00.000Z`),
        },
        agreement: {
          state: { in: CHARGE_STATES as Prisma.EnumAgreementStateFilter['in'] },
          autopayMandates: { some: { status: 'ACTIVE' } },
        },
      },
      include: {
        agreement: {
          include: { autopayMandates: { where: { status: 'ACTIVE' } } },
        },
        autopay: true,
      },
    });
    for (const i of due) {
      const m = i.agreement.autopayMandates[0];
      if (!m || i.autopay.some((c) => c.mandateId === m.id)) continue;
      const dueDate = dateOnly(i.dueDate)!;
      const amount = Math.min(i.amount - i.amountPaid, m.maxAmount);
      if (amount <= 0 || daysBetween(today, dueDate) < 1) continue;
      const chargeId = `VNC_${i.agreement.number}_${i.sequence}_${randomBytes(3).toString('hex')}`;
      let row: AutopayCharge;
      try {
        row = await this.prisma.autopayCharge.create({
          data: {
            mandateId: m.id,
            agreementId: i.agreementId,
            instalmentId: i.id,
            chargeId,
            amount,
            scheduledFor: new Date(`${dueDate}T00:00:00.000Z`),
          },
        });
      } catch {
        continue; // raised by a parallel run
      }
      try {
        const r = await this.gateway.charge({
          subscriptionId: m.subscriptionId,
          chargeId,
          amountPaise: amount,
          scheduleDate: dueDate,
          remarks: `Volt Neo ${i.agreement.number} instalment ${i.sequence}`,
        });
        await this.prisma.autopayCharge.update({
          where: { id: row.id },
          data: { gatewayRef: r.gatewayRef },
        });
        result.chargesRaised++;
      } catch (err) {
        await this.prisma.autopayCharge.update({
          where: { id: row.id },
          data: { status: 'FAILED', failureReason: (err as Error).message.slice(0, 300) },
        });
        result.chargesFailed++;
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // The pretend gateway (development and tests)
  // ---------------------------------------------------------------------------

  private fake() {
    if (this.gateway.name !== 'fake') {
      throw new ForbiddenException('Only the pretend gateway can be simulated');
    }
  }

  /** Development: the driver approved (ACTIVE) or cancelled the mandate in their UPI app. */
  async simulateMandate(mandateId: string, status: string) {
    this.fake();
    const m = await this.prisma.autopayMandate.findUnique({ where: { id: mandateId } });
    if (!m) throw new NotFoundException('Mandate not found');
    await this.webhooks.process(
      'fake',
      {
        kind: 'mandate',
        eventId: `sim:${m.subscriptionId}:${status}:${Date.now()}`,
        subscriptionId: m.subscriptionId,
        status,
      },
      { simulated: true, status },
    );
    return this.view(m.agreementId);
  }

  /** Development: the gateway took (SUCCESS) or failed to take a charge. */
  async simulateCharge(chargeId: string, status: 'SUCCESS' | 'FAILED') {
    this.fake();
    const c = await this.prisma.autopayCharge.findUnique({ where: { id: chargeId } });
    if (!c) throw new NotFoundException('Charge not found');
    if (c.status !== 'SCHEDULED' && c.status !== 'NOTIFIED') {
      throw new BadRequestException('This charge is finished');
    }
    await this.webhooks.process(
      'fake',
      {
        kind: 'charge',
        eventId: `sim:${c.chargeId}:${status}`,
        chargeId: c.chargeId,
        status,
        amountPaise: c.amount,
        providerRef: `fake_txn_${c.chargeId}`,
        paidAt: this.clock.now().toISOString(),
        reason: status === 'FAILED' ? 'Insufficient balance (simulated)' : null,
      },
      { simulated: true, status },
    );
    return this.view(c.agreementId);
  }

  /** For the approval page. */
  async byCode(code: string) {
    if (!/^[A-Za-z0-9]{8}$/.test(code)) return null;
    return this.prisma.autopayMandate.findUnique({
      where: { shortCode: code },
      include: { driver: { select: { language: true } }, agreement: { select: { number: true } } },
    });
  }

  /** After the approval page: refresh from the gateway and return the mandate. */
  async afterApproval(code: string) {
    const m = await this.byCode(code);
    if (m?.status === 'PENDING') await this.refresh(m);
    return m ? this.prisma.autopayMandate.findUnique({ where: { id: m.id } }) : null;
  }

  mapStatus(gateway: string) {
    return mandateStatusFor(gateway);
  }
}
