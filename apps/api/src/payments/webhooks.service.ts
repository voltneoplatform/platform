import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PAYABLE_STATES } from '@voltneo/shared';
import type { Prisma } from '../generated/prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { isUniqueViolation, serializable, type Tx } from '../common/util';
import { PaymentsService } from './payments.service';
import { rupeesToPaiseExact } from './gateway';
import { mandateStatusFor } from './autopay-status';

/**
 * The built-in "test" provider's event, received as-is. Real gateways are
 * translated into a NormalisedEvent by their own parser below.
 */
export interface PaymentEvent {
  eventId: string;
  type: string;
  agreementNumber: string;
  amountPaise: number;
  method: 'UPI' | 'CARD';
  providerRef: string;
  paidAt: string;
}

/** What every provider's webhook becomes before it touches money. */
export type NormalisedEvent =
  | {
      kind: 'payment';
      eventId: string;
      /** Our payment link ID, when the payment came through one. */
      linkId?: string;
      agreementNumber?: string;
      amountPaise: number;
      method: 'UPI' | 'CARD';
      providerRef: string;
      paidAt: string;
    }
  | { kind: 'link_closed'; eventId: string; linkId: string; status: 'EXPIRED' | 'CANCELLED' }
  /** A UPI AutoPay mandate changed status at the gateway. */
  | { kind: 'mandate'; eventId: string; subscriptionId: string; status: string }
  /** An AutoPay charge was notified, taken, failed or cancelled. */
  | {
      kind: 'charge';
      eventId: string;
      chargeId: string;
      status: 'NOTIFIED' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
      amountPaise: number | null;
      providerRef: string | null;
      paidAt: string;
      reason: string | null;
    }
  | { kind: 'ignored'; eventId: string; note: string };

export type WebhookOutcome =
  | { status: 'processed'; paymentId: string }
  | { status: 'needs_review'; note: string }
  | { status: 'ignored'; note: string }
  | { status: 'duplicate' };

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

function parseTestEvent(body: unknown): NormalisedEvent {
  const e = body as Partial<PaymentEvent> | null;
  const ok =
    !!e &&
    typeof e.eventId === 'string' &&
    e.eventId.length >= 1 &&
    e.eventId.length <= 100 &&
    typeof e.type === 'string' &&
    typeof e.agreementNumber === 'string' &&
    Number.isSafeInteger(e.amountPaise) &&
    (e.amountPaise ?? 0) > 0 &&
    (e.method === 'UPI' || e.method === 'CARD') &&
    typeof e.providerRef === 'string' &&
    e.providerRef.length >= 1 &&
    e.providerRef.length <= 100 &&
    typeof e.paidAt === 'string' &&
    !Number.isNaN(Date.parse(e.paidAt));
  if (!ok) throw new BadRequestException('Unrecognised payment event');
  const ev = e as PaymentEvent;
  if (ev.type !== 'payment.succeeded') {
    return { kind: 'ignored', eventId: ev.eventId, note: `Event type ${ev.type} is not used` };
  }
  return {
    kind: 'payment',
    eventId: ev.eventId,
    agreementNumber: ev.agreementNumber,
    amountPaise: ev.amountPaise,
    method: ev.method,
    providerRef: ev.providerRef,
    paidAt: ev.paidAt,
  };
}

/**
 * Cashfree PAYMENT_LINK_EVENT (docs: payment-links/webhooks). Links are UPI
 * only and for the full amount, so a paid link is one UPI payment. Other
 * Cashfree event types are stored and ignored.
 */
export function parseCashfreeEvent(body: unknown, idempotencyKey?: string): NormalisedEvent {
  const b = body as {
    type?: string;
    event_time?: string;
    data?: {
      cf_link_id?: string | number;
      link_id?: string;
      link_status?: string;
      order?: {
        order_id?: string;
        order_amount?: string | number;
        transaction_id?: string | number;
        transaction_status?: string;
      } | null;
    };
  } | null;
  if (!b || typeof b.type !== 'string')
    throw new BadRequestException('Unrecognised Cashfree event');
  const d = b.data ?? {};
  const order = d.order ?? null;
  const fallbackId = [b.type, d.cf_link_id ?? d.link_id, d.link_status, order?.transaction_id]
    .filter((x) => x !== undefined && x !== null)
    .join(':');
  const eventId = (idempotencyKey || fallbackId).slice(0, 100);
  if (b.type.startsWith('SUBSCRIPTION_')) return parseCashfreeSubscriptionEvent(b, eventId);
  if (b.type !== 'PAYMENT_LINK_EVENT') {
    return { kind: 'ignored', eventId, note: `Cashfree event ${b.type} is not used` };
  }
  if (typeof d.link_id !== 'string' || !d.link_id) {
    throw new BadRequestException('Cashfree link event without link_id');
  }
  if (d.link_status === 'EXPIRED' || d.link_status === 'CANCELLED') {
    return { kind: 'link_closed', eventId, linkId: d.link_id, status: d.link_status };
  }
  if (
    (d.link_status === 'PAID' || d.link_status === 'PARTIALLY_PAID') &&
    order &&
    order.transaction_status === 'SUCCESS' &&
    order.order_amount !== undefined
  ) {
    let amountPaise: number;
    try {
      amountPaise = rupeesToPaiseExact(order.order_amount);
    } catch {
      throw new BadRequestException('Cashfree event with an unreadable amount');
    }
    const ref = order.transaction_id ?? order.order_id;
    if (ref === undefined || ref === null || amountPaise <= 0) {
      throw new BadRequestException('Cashfree payment event without a transaction');
    }
    return {
      kind: 'payment',
      eventId,
      linkId: d.link_id,
      amountPaise,
      method: 'UPI',
      providerRef: String(ref).slice(0, 100),
      paidAt:
        b.event_time && !Number.isNaN(Date.parse(b.event_time))
          ? b.event_time
          : new Date().toISOString(),
    };
  }
  return {
    kind: 'ignored',
    eventId,
    note: `Link ${d.link_id} status ${d.link_status ?? 'unknown'} needs no action`,
  };
}

/**
 * Cashfree subscription (UPI AutoPay) events (docs: payments/subscription/webhooks).
 * Field names are read defensively: REQUIRES VALIDATION against sandbox payloads.
 */
function parseCashfreeSubscriptionEvent(
  b: { type?: string; event_time?: string; data?: unknown },
  fallbackId: string,
): NormalisedEvent {
  const d = (b.data ?? {}) as {
    subscription_details?: { subscription_id?: string; subscription_status?: string };
    subscription_id?: string;
    subscription_status?: string;
    payment_id?: string;
    cf_payment_id?: string | number;
    cf_txn_id?: string | number;
    payment_amount?: string | number;
    payment_status?: string;
    payment_type?: string;
    failure_details?: { failure_reason?: string } | null;
  };
  const type = b.type!;
  const subscriptionId = d.subscription_details?.subscription_id ?? d.subscription_id;
  const eventId =
    [type, subscriptionId, d.payment_id, d.cf_payment_id, d.payment_status]
      .filter((x) => x !== undefined && x !== null)
      .join(':')
      .slice(0, 100) || fallbackId;
  if (type === 'SUBSCRIPTION_STATUS_CHANGED') {
    const status = d.subscription_details?.subscription_status ?? d.subscription_status;
    if (!subscriptionId || !status)
      throw new BadRequestException('Subscription event without status');
    return { kind: 'mandate', eventId, subscriptionId, status };
  }
  if (type === 'SUBSCRIPTION_AUTH_STATUS') {
    if (subscriptionId && d.payment_status === 'FAILED') {
      return { kind: 'mandate', eventId, subscriptionId, status: 'AUTH_FAILED' };
    }
    return { kind: 'ignored', eventId, note: `AutoPay approval ${d.payment_status ?? 'update'}` };
  }
  const status =
    type === 'SUBSCRIPTION_PAYMENT_SUCCESS'
      ? 'SUCCESS'
      : type === 'SUBSCRIPTION_PAYMENT_FAILED'
        ? 'FAILED'
        : type === 'SUBSCRIPTION_PAYMENT_CANCELLED'
          ? 'CANCELLED'
          : type === 'SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED'
            ? 'NOTIFIED'
            : null;
  if (!status || d.payment_type === 'AUTH') {
    return { kind: 'ignored', eventId, note: `Cashfree event ${type} is not used` };
  }
  if (!d.payment_id) throw new BadRequestException('Subscription payment event without payment_id');
  let amountPaise: number | null = null;
  if (d.payment_amount !== undefined) {
    try {
      amountPaise = rupeesToPaiseExact(d.payment_amount);
    } catch {
      throw new BadRequestException('Cashfree event with an unreadable amount');
    }
  }
  const ref = d.cf_txn_id ?? d.cf_payment_id;
  return {
    kind: 'charge',
    eventId,
    chargeId: d.payment_id,
    status,
    amountPaise,
    providerRef: ref === undefined || ref === null ? null : String(ref).slice(0, 100),
    paidAt:
      b.event_time && !Number.isNaN(Date.parse(b.event_time))
        ? b.event_time
        : new Date().toISOString(),
    reason: d.failure_details?.failure_reason?.slice(0, 300) ?? null,
  };
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly messaging: MessagingService,
  ) {}

  private secret(provider: string): string {
    const secret = this.config.paymentWebhookSecrets[provider];
    if (!secret) throw new NotFoundException('Unknown payment provider');
    return secret;
  }

  /** Checks the signature of the exact bytes received, in the provider's own scheme. */
  verify(provider: string, rawBody: Buffer | undefined, headers: Headers): void {
    const secret = this.secret(provider);
    if (!rawBody?.length) throw new BadRequestException('Empty body');
    let expected: Buffer;
    let given: Buffer;
    if (provider === 'cashfree') {
      // Base64(HMAC-SHA256(timestamp + raw body, secret key)) (Cashfree docs).
      const ts = header(headers, 'x-webhook-timestamp') ?? '';
      expected = createHmac('sha256', secret)
        .update(Buffer.concat([Buffer.from(ts), rawBody]))
        .digest();
      given = Buffer.from(header(headers, 'x-webhook-signature') ?? '', 'base64');
    } else {
      expected = createHmac('sha256', secret).update(rawBody).digest();
      given = Buffer.from(
        (header(headers, 'x-voltneo-signature') ?? '').replace(/^sha256=/, ''),
        'hex',
      );
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Bad signature');
    }
  }

  async receive(
    provider: string,
    rawBody: Buffer | undefined,
    headers: Headers,
  ): Promise<WebhookOutcome> {
    this.verify(provider, rawBody, headers);
    let body: unknown;
    try {
      body = JSON.parse(rawBody!.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not JSON');
    }
    const event =
      provider === 'cashfree'
        ? parseCashfreeEvent(body, header(headers, 'x-idempotency-key'))
        : parseTestEvent(body);
    return this.process(provider, event, body as Prisma.InputJsonValue);
  }

  /**
   * Applies a normalised event once. Shared by real webhooks and the
   * development "mark as paid" for fake links.
   */
  async process(
    provider: string,
    event: NormalisedEvent,
    payload: Prisma.InputJsonValue,
  ): Promise<WebhookOutcome> {
    let messageId: string | null = null;
    let outcome: WebhookOutcome;
    try {
      outcome = await serializable(this.prisma, async (tx) => {
        const seen = await tx.webhookEvent.findUnique({
          where: { provider_eventId: { provider, eventId: event.eventId } },
        });
        if (seen) return { status: 'duplicate' } as const;

        const store = (
          status: 'PROCESSED' | 'NEEDS_REVIEW',
          note: string | null,
          paymentId?: string,
        ) =>
          tx.webhookEvent.create({
            data: { provider, eventId: event.eventId, payload, status, note, paymentId },
          });
        const review = async (note: string) => {
          await store('NEEDS_REVIEW', note);
          this.logger.warn(`${provider} event ${event.eventId} needs review: ${note}`);
          return { status: 'needs_review', note } as const;
        };

        if (event.kind === 'ignored') {
          await store('PROCESSED', event.note);
          return { status: 'ignored', note: event.note } as const;
        }
        if (event.kind === 'mandate') {
          const note = await this.mandateEvent(tx, event.subscriptionId, event.status);
          if (note.startsWith('No AutoPay')) return review(note);
          await store('PROCESSED', note);
          return { status: 'ignored', note } as const;
        }
        if (event.kind === 'charge') {
          const charge = await tx.autopayCharge.findUnique({
            where: { chargeId: event.chargeId },
            include: { mandate: true },
          });
          if (!charge) return review(`No AutoPay charge ${event.chargeId}`);
          if (event.status !== 'SUCCESS') {
            const from = event.status === 'NOTIFIED' ? ['SCHEDULED'] : ['SCHEDULED', 'NOTIFIED'];
            await tx.autopayCharge.updateMany({
              where: { id: charge.id, status: { in: from as ('SCHEDULED' | 'NOTIFIED')[] } },
              data: { status: event.status, failureReason: event.reason },
            });
            const note = `AutoPay charge ${event.chargeId} ${event.status.toLowerCase()}`;
            await store('PROCESSED', note);
            return { status: 'ignored', note } as const;
          }
          if (charge.paymentId) {
            await store('PROCESSED', 'AutoPay charge already recorded', charge.paymentId);
            return { status: 'processed', paymentId: charge.paymentId } as const;
          }
          const a = await tx.agreement.findUnique({ where: { id: charge.agreementId } });
          if (!a || !(PAYABLE_STATES as readonly string[]).includes(a.state)) {
            return review(
              `AutoPay took ${event.chargeId} but agreement ${a?.number ?? '?'} cannot take payments (${a?.state ?? 'missing'}); refund or apply by hand`,
            );
          }
          const providerRef = event.providerRef ?? `autopay:${event.chargeId}`;
          const dupPay = await tx.payment.findUnique({
            where: { provider_providerRef: { provider, providerRef } },
          });
          if (dupPay) {
            await store('PROCESSED', 'Payment already recorded from an earlier event', dupPay.id);
            return { status: 'processed', paymentId: dupPay.id } as const;
          }
          const paidAt = new Date(event.paidAt);
          const result = await this.payments.apply(tx, {
            agreementId: a.id,
            amount: event.amountPaise ?? charge.amount,
            method: 'UPI',
            source: 'GATEWAY',
            provider,
            providerRef,
            note: `UPI AutoPay ${event.chargeId}`,
            receivedAt: paidAt.getTime() > Date.now() ? new Date() : paidAt,
            allowExcess: true,
            actor: { type: 'SYSTEM', id: null },
          });
          await tx.autopayCharge.update({
            where: { id: charge.id },
            data: { status: 'SUCCESS', paymentId: result.paymentId, failureReason: null },
          });
          await store('PROCESSED', null, result.paymentId);
          messageId = result.messageId;
          return { status: 'processed', paymentId: result.paymentId } as const;
        }
        if (event.kind === 'link_closed') {
          await this.closeLink(tx, event.linkId, event.status, `Gateway reported ${event.status}`);
          await store('PROCESSED', `Link ${event.linkId} ${event.status.toLowerCase()}`);
          return { status: 'ignored', note: `Link ${event.status.toLowerCase()}` } as const;
        }

        // A payment.
        const link = event.linkId
          ? await tx.paymentLink.findUnique({ where: { linkId: event.linkId } })
          : null;
        if (event.linkId && !link) return review(`No payment link ${event.linkId}`);
        const a = link
          ? await tx.agreement.findUnique({ where: { id: link.agreementId } })
          : await tx.agreement.findUnique({ where: { number: event.agreementNumber ?? '' } });
        if (!a) return review(`No agreement ${event.agreementNumber ?? ''}`);
        if (!(PAYABLE_STATES as readonly string[]).includes(a.state)) {
          return review(
            `Agreement ${a.number} cannot take payments in state ${a.state}; refund or apply by hand`,
          );
        }
        const dup = await tx.payment.findUnique({
          where: { provider_providerRef: { provider, providerRef: event.providerRef } },
        });
        if (dup) {
          await store('PROCESSED', 'Payment already recorded from an earlier event', dup.id);
          return { status: 'processed', paymentId: dup.id } as const;
        }
        const paidAt = new Date(event.paidAt);
        const result = await this.payments.apply(tx, {
          agreementId: a.id,
          amount: event.amountPaise,
          method: event.method,
          source: 'GATEWAY',
          provider,
          providerRef: event.providerRef,
          note: link ? `UPI payment link ${link.linkId}` : null,
          receivedAt: paidAt.getTime() > Date.now() ? new Date() : paidAt,
          allowExcess: true,
          actor: { type: 'SYSTEM', id: null },
        });
        if (link?.status === 'ACTIVE') {
          await tx.paymentLink.update({
            where: { id: link.id },
            data: { status: 'PAID', paymentId: result.paymentId, closedAt: new Date() },
          });
        }
        await store(
          'PROCESSED',
          link && link.status !== 'ACTIVE' ? `Paid on a ${link.status.toLowerCase()} link` : null,
          result.paymentId,
        );
        messageId = result.messageId;
        return { status: 'processed', paymentId: result.paymentId } as const;
      });
    } catch (err) {
      // Two deliveries of the same event at once: the second loses the race.
      if (isUniqueViolation(err)) return { status: 'duplicate' };
      throw err;
    }
    if (messageId) await this.messaging.deliver([messageId]);
    return outcome;
  }

  /** Applies a mandate status from the gateway; returns a note for the event log. */
  async mandateEvent(tx: Tx, subscriptionId: string, gatewayStatus: string): Promise<string> {
    const m = await tx.autopayMandate.findUnique({ where: { subscriptionId } });
    if (!m) return `No AutoPay mandate ${subscriptionId}`;
    const next = mandateStatusFor(gatewayStatus);
    const ended = m.status === 'CANCELLED' || m.status === 'FAILED';
    if (!next || ended || next.status === m.status) {
      await tx.autopayMandate.update({ where: { id: m.id }, data: { gatewayStatus } });
      return `AutoPay ${subscriptionId}: ${gatewayStatus}`;
    }
    const now = new Date();
    await tx.autopayMandate.update({
      where: { id: m.id },
      data: {
        status: next.status,
        gatewayStatus,
        activatedAt: next.status === 'ACTIVE' ? now : m.activatedAt,
        endedAt: next.status === 'ACTIVE' ? null : now,
        endedBy: next.status === 'ACTIVE' ? null : (next.endedBy ?? 'GATEWAY'),
        statusNote: next.status === 'ACTIVE' ? null : `Gateway reported ${gatewayStatus}`,
      },
    });
    if (next.status !== 'ACTIVE') {
      await tx.autopayCharge.updateMany({
        where: { mandateId: m.id, status: { in: ['SCHEDULED', 'NOTIFIED'] } },
        data: { status: 'CANCELLED', failureReason: `Mandate ${gatewayStatus.toLowerCase()}` },
      });
    }
    return `AutoPay ${subscriptionId}: ${m.status} → ${next.status}`;
  }

  private async closeLink(tx: Tx, linkId: string, status: 'EXPIRED' | 'CANCELLED', note: string) {
    await tx.paymentLink.updateMany({
      where: { linkId, status: 'ACTIVE' },
      data: { status, closedAt: new Date(), closedNote: note },
    });
  }
}
