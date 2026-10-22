import { Injectable, Logger } from '@nestjs/common';

export interface OtpMessage {
  channel: 'EMAIL' | 'SMS';
  destination: string;
  code: string;
  recipientName: string;
}

/**
 * Delivers login codes. Every outside service sits behind an adapter so a
 * provider can be swapped without touching business logic (spec section 7).
 * Real SMS and email adapters are added once the founder picks providers.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Development only: writes the code to the server log. Refused in production by config. */
@Injectable()
export class LogOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  async send(m: OtpMessage): Promise<void> {
    this.logger.warn(`[dev] ${m.channel} to ${m.destination} (${m.recipientName}): code ${m.code}`);
  }
}

/** Automated tests only: keeps sent codes in memory so tests can read them. */
@Injectable()
export class MemoryOtpSender implements OtpSender {
  readonly sent: OtpMessage[] = [];

  async send(m: OtpMessage): Promise<void> {
    this.sent.push(m);
  }

  lastCodeFor(destination: string): string | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.destination === destination) return this.sent[i]!.code;
    }
    return undefined;
  }
}
