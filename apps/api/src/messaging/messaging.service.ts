import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../common/util';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';
import { EMAIL_SENDER, type EmailSender, type EmailMessage } from './email-sender';
import type { OutboundMessage } from '../generated/prisma/client';

/** Builds the subject and attachment of an email from its stored row (e.g. a receipt PDF). */
export type EmailContent = (
  row: OutboundMessage,
) => Promise<Pick<EmailMessage, 'subject' | 'attachment'>>;

export interface QueuedMessage {
  driverId: string | null;
  toPhone: string;
  /** Email messages only. */
  toEmail?: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  template: string;
  language: DriverLanguage;
  body: string;
  paymentId?: string;
  agreementId?: string;
}

/**
 * Messages are written to outbound_messages inside the business transaction
 * and sent only after it commits, so a driver is never told about a payment
 * that was rolled back. A failed send is recorded and can be retried.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private readonly emailContent = new Map<string, EmailContent>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /** Lets a module say how its emails look (subject, attachment) for a template. */
  registerEmail(template: string, content: EmailContent) {
    this.emailContent.set(template, content);
  }

  async queue(tx: Tx, m: QueuedMessage): Promise<string> {
    const row = await tx.outboundMessage.create({
      data: {
        ...m,
        status: 'PENDING',
        provider: m.channel === 'EMAIL' ? this.email.provider : this.sender.provider,
      },
      select: { id: true },
    });
    return row.id;
  }

  private async send(m: OutboundMessage): Promise<{ providerRef: string | null }> {
    if (m.channel !== 'EMAIL') {
      return this.sender.send({
        channel: m.channel,
        to: m.toPhone,
        body: m.body,
        template: m.template,
        language: m.language,
      });
    }
    if (!m.toEmail) throw new Error('Email message without an address');
    const content = this.emailContent.get(m.template);
    const extra = content ? await content(m) : { subject: 'Volt Neo' };
    return this.email.send({ to: m.toEmail, text: m.body, ...extra });
  }

  /**
   * Sends queued messages; never throws, so a provider outage cannot undo a
   * payment. An email queued with the same payment (an emailed receipt) goes
   * with its SMS, so callers need not know about it.
   */
  async deliver(ids: string[]): Promise<void> {
    const all = [...ids];
    const payments = await this.prisma.outboundMessage.findMany({
      where: { id: { in: ids }, paymentId: { not: null } },
      select: { paymentId: true },
    });
    if (payments.length) {
      const emails = await this.prisma.outboundMessage.findMany({
        where: {
          paymentId: { in: payments.map((p) => p.paymentId!) },
          channel: 'EMAIL',
          status: 'PENDING',
        },
        select: { id: true },
      });
      for (const e of emails) if (!all.includes(e.id)) all.push(e.id);
    }
    for (const id of all) {
      const m = await this.prisma.outboundMessage.findUnique({ where: { id } });
      if (!m || m.status === 'SENT') continue;
      try {
        const { providerRef } = await this.send(m);
        await this.prisma.outboundMessage.update({
          where: { id },
          data: { status: 'SENT', providerRef, sentAt: new Date(), error: null },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Message ${id} failed: ${error}`);
        await this.prisma.outboundMessage.update({
          where: { id },
          data: { status: 'FAILED', error: error.slice(0, 500) },
        });
      }
    }
  }
}
