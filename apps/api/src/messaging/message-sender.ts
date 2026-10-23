import { Injectable, Logger } from '@nestjs/common';

export interface DriverMessage {
  channel: 'SMS' | 'WHATSAPP';
  to: string;
  body: string;
  template: string;
}

/**
 * Sends SMS and WhatsApp messages to drivers. Every outside service sits behind
 * an adapter (spec section 7); a real provider adapter is added once the
 * founder opens an account. Until then messages are logged, not delivered.
 */
export interface MessageSender {
  readonly provider: string;
  send(message: DriverMessage): Promise<{ providerRef: string | null }>;
}

export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

/** Development only: writes the message to the server log. */
@Injectable()
export class LogMessageSender implements MessageSender {
  readonly provider = 'log';
  private readonly logger = new Logger('Messages');

  async send(m: DriverMessage) {
    this.logger.warn(`[dev] ${m.channel} to ${m.to} (${m.template}): ${m.body}`);
    return { providerRef: null };
  }
}

/** Automated tests only: keeps messages in memory; can be told to fail. */
@Injectable()
export class MemoryMessageSender implements MessageSender {
  readonly provider = 'memory';
  readonly sent: DriverMessage[] = [];
  failNext = false;

  async send(m: DriverMessage) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated provider failure');
    }
    this.sent.push(m);
    return { providerRef: `mem-${this.sent.length}` };
  }
}
