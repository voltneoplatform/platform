import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PAYABLE_STATES } from '@voltneo/shared';
import type { Prisma } from '../generated/prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';
import { isUniqueViolation, serializable } from '../common/util';
import { PaymentsService } from './payments.service';

/**
 * The event every provider adapter produces. The built-in "test" provider
 * receives it as-is; a real gateway adapter (e.g. Cashfree) will translate its
 * own payload into this shape once an account exists.
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

function parseEvent(body: unknown): PaymentEvent {
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
  return e as PaymentEvent;
}

export type WebhookOutcome =
  | { status: 'processed'; paymentId: string }
  | { status: 'needs_review'; note: string }
  | { status: 'ignored'; note: string }
  | { status: 'duplicate' };

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly messaging: MessagingService,
  ) {}

  /** Checks the HMAC-SHA256 signature of the exact bytes received. */
  verify(provider: string, rawBody: Buffer | undefined, signature: string | undefined): void {
    const secret = this.config.paymentWebhookSecrets[provider];
    if (!secret) throw new NotFoundException('Unknown payment provider');
    if (!rawBody?.length) throw new BadRequestException('Empty body');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const given = Buffer.from((signature ?? '').replace(/^sha256=/, ''), 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Bad signature');
    }
  }

  async receive(
    provider: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<WebhookOutcome> {
    this.verify(provider, rawBody, signature);
    let body: unknown;
    try {
      body = JSON.parse(rawBody!.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not JSON');
    }
    const event = parseEvent(body);
    const payload = body as Prisma.InputJsonValue;

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

        if (event.type !== 'payment.succeeded') {
          await store('PROCESSED', `Ignored event type ${event.type}`);
          return { status: 'ignored', note: `Event type ${event.type} is not used` } as const;
        }
        const review = async (note: string) => {
          await store('NEEDS_REVIEW', note);
          return { status: 'needs_review', note } as const;
        };
        const a = await tx.agreement.findUnique({ where: { number: event.agreementNumber } });
        if (!a) return review(`No agreement ${event.agreementNumber}`);
        if (!(PAYABLE_STATES as readonly string[]).includes(a.state)) {
          return review(`Agreement ${a.number} cannot take payments in state ${a.state}`);
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
          receivedAt: paidAt.getTime() > Date.now() ? new Date() : paidAt,
          allowExcess: true,
          actor: { type: 'SYSTEM', id: null },
        });
        await store('PROCESSED', null, result.paymentId);
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
}
