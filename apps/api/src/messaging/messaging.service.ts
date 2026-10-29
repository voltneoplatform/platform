import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { Tx } from '../common/util';
import { MESSAGE_SENDER, type MessageSender } from './message-sender';

export interface QueuedMessage {
  driverId: string | null;
  toPhone: string;
  channel: 'SMS' | 'WHATSAPP';
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

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
  ) {}

  async queue(tx: Tx, m: QueuedMessage): Promise<string> {
    const row = await tx.outboundMessage.create({
      data: { ...m, status: 'PENDING', provider: this.sender.provider },
      select: { id: true },
    });
    return row.id;
  }

  /** Sends queued messages; never throws, so a provider outage cannot undo a payment. */
  async deliver(ids: string[]): Promise<void> {
    for (const id of ids) {
      const m = await this.prisma.outboundMessage.findUnique({ where: { id } });
      if (!m || m.status === 'SENT') continue;
      try {
        const { providerRef } = await this.sender.send({
          channel: m.channel,
          to: m.toPhone,
          body: m.body,
          template: m.template,
          language: m.language,
        });
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
