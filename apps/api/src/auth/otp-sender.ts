import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SesConfig } from '../config/app-config';

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
  /** Channels this sender can deliver; a sign-in on any other channel is refused up front. */
  readonly channels: ReadonlySet<OtpMessage['channel']>;
  send(message: OtpMessage): Promise<void>;
}

const BOTH = new Set<OtpMessage['channel']>(['EMAIL', 'SMS']);

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Development only: writes the code to the server log. Refused in production by config. */
@Injectable()
export class LogOtpSender implements OtpSender {
  readonly channels = BOTH;
  private readonly logger = new Logger('OTP');

  async send(m: OtpMessage): Promise<void> {
    this.logger.warn(`[dev] ${m.channel} to ${m.destination} (${m.recipientName}): code ${m.code}`);
  }
}

/** Automated tests only: keeps sent codes in memory so tests can read them. */
@Injectable()
export class MemoryOtpSender implements OtpSender {
  readonly channels = BOTH;
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

/** The parts of the SES client this sender uses, so tests can pass a stand-in. */
export interface SesLike {
  send(command: SendEmailCommand): Promise<unknown>;
}

/**
 * Emails sign-in codes through AWS SES (Mumbai). Email only: staff who sign in
 * with a phone number are told to use their email until an SMS provider is added.
 */
export class SesOtpSender implements OtpSender {
  readonly channels = new Set<OtpMessage['channel']>(['EMAIL']);
  private readonly client: SesLike;

  constructor(
    private readonly config: SesConfig,
    private readonly ttlMinutes: number,
    private readonly testSite: boolean,
    client?: SesLike,
  ) {
    this.client =
      client ??
      new SESv2Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async send(m: OtpMessage): Promise<void> {
    if (m.channel !== 'EMAIL') throw new Error('SES sends email only');
    const prefix = this.testSite ? '[Test site] ' : '';
    const text = [
      `Hello ${m.recipientName},`,
      '',
      `Your Volt Neo sign-in code is ${m.code}. It expires in ${this.ttlMinutes} minutes.`,
      '',
      'Volt Neo staff will never ask you for this code. If you did not try to sign in, ignore this email.',
    ].join('\n');
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.config.from,
        Destination: { ToAddresses: [m.destination] },
        Content: {
          Simple: {
            Subject: { Data: `${prefix}Your Volt Neo sign-in code: ${m.code}`, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}
