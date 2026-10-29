import { Injectable, Logger } from '@nestjs/common';
import type { Lang } from '../documents/texts';
import { dltKeyFor } from './sms-templates';
import type { SmsGatewayHubClient } from './smsgatewayhub';

export interface DriverMessage {
  channel: 'SMS' | 'WHATSAPP';
  to: string;
  body: string;
  template: string;
  language: Lang;
}

/**
 * Sends SMS and WhatsApp messages to drivers. Every outside service sits behind
 * an adapter (spec section 7): SMSGatewayHub for SMS; logged in development.
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

/** Driver SMS through SMSGatewayHub, each matched to its DLT template. WhatsApp is not set up. */
export class SmsGatewayHubMessageSender implements MessageSender {
  readonly provider = 'smsgatewayhub';

  constructor(private readonly client: SmsGatewayHubClient) {}

  async send(m: DriverMessage) {
    if (m.channel !== 'SMS') throw new Error('WhatsApp is not set up');
    const key = dltKeyFor(m.template);
    if (!key) throw new Error(`No DLT template for message "${m.template}"`);
    return this.client.send({ to: m.to, text: m.body, key, lang: m.language });
  }
}
