import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { SesConfig } from '../config/app-config';
import type { SesLike } from '../auth/otp-sender';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; contentType: string; content: Buffer };
}

/** Sends emails to drivers (receipts with the PDF attached). */
export interface EmailSender {
  readonly provider: string;
  send(m: EmailMessage): Promise<{ providerRef: string | null }>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

@Injectable()
export class LogEmailSender implements EmailSender {
  readonly provider = 'log';
  private readonly logger = new Logger('Email');
  async send(m: EmailMessage) {
    this.logger.warn(
      `[dev] email to ${m.to}: ${m.subject}${m.attachment ? ` (+ ${m.attachment.filename})` : ''}`,
    );
    return { providerRef: null };
  }
}

@Injectable()
export class MemoryEmailSender implements EmailSender {
  readonly provider = 'memory';
  readonly sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
    return { providerRef: `mem-email-${this.sent.length}` };
  }
}

/** "=?UTF-8?B?...?=" so Bengali and Hindi subjects survive mail servers. */
function header(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

const wrap = (b64: string) => b64.replace(/.{1,76}/g, '$&\r\n');

/** A plain-text email with one optional attachment, as MIME. */
export function mime(from: string, m: EmailMessage): Buffer {
  const boundary = `vn_${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${m.to}`,
    `Subject: ${header(m.subject)}`,
    'MIME-Version: 1.0',
  ];
  const text = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(m.text).toString('base64')),
  ];
  if (!m.attachment) return Buffer.from([...lines, ...text].join('\r\n'));
  const name = m.attachment.filename.replace(/[^\w.-]/g, '_');
  return Buffer.from(
    [
      ...lines,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      ...text,
      `--${boundary}`,
      `Content-Type: ${m.attachment.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(m.attachment.content.toString('base64')),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
}

/**
 * Email through AWS SES (Mumbai), from the same sender as staff sign-in codes.
 * While SES is in its sandbox only confirmed addresses receive mail; others are
 * recorded as failed.
 */
export class SesEmailSender implements EmailSender {
  readonly provider = 'ses';
  private readonly client: SesLike;
  constructor(
    private readonly config: SesConfig,
    private readonly testSite: boolean,
    client?: SesLike,
  ) {
    this.client =
      client ??
      new SESv2Client({
        region: config.region,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
  }
  async send(m: EmailMessage) {
    const subject = this.testSite ? `[Test site] ${m.subject}` : m.subject;
    const res = (await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.config.from,
        Destination: { ToAddresses: [m.to] },
        Content: { Raw: { Data: mime(this.config.from, { ...m, subject }) } },
      }),
    )) as { MessageId?: string } | undefined;
    return { providerRef: res?.MessageId ?? null };
  }
}
