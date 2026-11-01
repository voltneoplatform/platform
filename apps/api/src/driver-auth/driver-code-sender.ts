import { Logger } from '@nestjs/common';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SesConfig } from '../config/app-config';
import { TEXTS, type Lang } from '../documents/texts';
import type { SmsGatewayHubClient } from '../messaging/smsgatewayhub';
import type { SesLike } from '../auth/otp-sender';
import { SESv2Client } from '@aws-sdk/client-sesv2';

export interface DriverCodeMessage {
  /** +91XXXXXXXXXX */
  phone: string;
  code: string;
  /** The language of the drivers on this phone (the first one's if they differ). */
  language: Lang;
  /** Names on this phone, for the test-site email only. */
  names: string[];
  /** Driver App sign-in (default) or a registration check read out to staff. */
  purpose?: CodePurpose;
}

export type CodePurpose = 'sign_in' | 'registration';

/**
 * Delivers Driver App sign-in codes. By SMS in the driver's language once the
 * DLT sign-in template is approved; on the test site, until then, by email to
 * the founder; in development, to the server log.
 */
export interface DriverCodeSender {
  /** Whether a code can be delivered for a driver who reads this language. */
  canSend(language: Lang, purpose?: CodePurpose): boolean;
  send(m: DriverCodeMessage): Promise<void>;
}

export const DRIVER_CODE_SENDER = Symbol('DRIVER_CODE_SENDER');

/** Automated tests: keeps codes in memory. */
export class MemoryDriverCodeSender implements DriverCodeSender {
  readonly sent: DriverCodeMessage[] = [];
  canSend(): boolean {
    return true;
  }
  async send(m: DriverCodeMessage): Promise<void> {
    this.sent.push(m);
  }
  lastCodeFor(phone: string): string | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.phone === phone) return this.sent[i]!.code;
    }
    return undefined;
  }
}

/** Development only: the code goes to the server log. */
export class LogDriverCodeSender implements DriverCodeSender {
  private readonly logger = new Logger('DriverCode');
  canSend(): boolean {
    return true;
  }
  async send(m: DriverCodeMessage): Promise<void> {
    const what = m.purpose === 'registration' ? 'Registration' : 'Driver App';
    this.logger.warn(`[dev] ${what} code for ${m.phone} (${m.names.join(', ')}): ${m.code}`);
  }
}

/** SMS through SMSGatewayHub on the approved DLT sign-in template, in the driver's language. */
export class SmsDriverCodeSender implements DriverCodeSender {
  constructor(
    private readonly client: SmsGatewayHubClient,
    private readonly ttlMinutes: number,
  ) {}
  canSend(language: Lang, purpose: CodePurpose = 'sign_in'): boolean {
    return this.client.ready(
      purpose === 'registration' ? 'registration_code' : 'sign_in_code',
      language,
    );
  }
  async send(m: DriverCodeMessage): Promise<void> {
    const registration = m.purpose === 'registration';
    const p = { code: m.code, minutes: String(this.ttlMinutes) };
    const text = registration
      ? TEXTS[m.language].registrationCodeSms(p)
      : TEXTS[m.language].signInCodeSms(p);
    await this.client.send({
      to: m.phone,
      text,
      key: registration ? 'registration_code' : 'sign_in_code',
      lang: m.language,
      otp: true,
    });
  }
}

/** Test site only: emails the code to the founder while SMS cannot be sent. */
export class TestEmailDriverCodeSender implements DriverCodeSender {
  private readonly client: SesLike;
  constructor(
    private readonly ses: SesConfig,
    private readonly to: string,
    client?: SesLike,
  ) {
    this.client =
      client ??
      new SESv2Client({
        region: ses.region,
        credentials: { accessKeyId: ses.accessKeyId, secretAccessKey: ses.secretAccessKey },
      });
  }
  canSend(): boolean {
    return true;
  }
  async send(m: DriverCodeMessage): Promise<void> {
    const who = m.names.join(', ');
    const registration = m.purpose === 'registration';
    const what = registration ? 'Driver registration code' : 'Driver App sign-in code';
    const text = [
      `${what} for ${who} (${m.phone}): ${m.code}`,
      '',
      'This is the Volt Neo test site. Codes come to this address because driver SMS is not switched on yet (the DLT templates are not approved).',
    ].join('\n');
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.ses.from,
        Destination: { ToAddresses: [this.to] },
        Content: {
          Simple: {
            Subject: {
              Data: `[Test site] ${registration ? 'Registration' : 'Driver App'} code ${m.code} for ${who}`,
              Charset: 'UTF-8',
            },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}

/** SMS when the template for that language is approved, otherwise the fallback (if any). */
export class RoutingDriverCodeSender implements DriverCodeSender {
  constructor(
    private readonly sms: SmsDriverCodeSender | null,
    private readonly fallback: DriverCodeSender | null,
  ) {}
  canSend(language: Lang, purpose?: CodePurpose): boolean {
    return Boolean(
      this.sms?.canSend(language, purpose) || this.fallback?.canSend(language, purpose),
    );
  }
  async send(m: DriverCodeMessage): Promise<void> {
    if (this.sms?.canSend(m.language, m.purpose)) return this.sms.send(m);
    if (this.fallback) return this.fallback.send(m);
    throw new Error('No way to send Driver App codes yet');
  }
}
