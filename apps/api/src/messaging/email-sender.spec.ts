import { describe, expect, it } from 'vitest';
import { mime } from './email-sender';

describe('emailed receipts', () => {
  it('builds a MIME email with a UTF-8 subject and a PDF attachment', () => {
    const raw = mime('Volt Neo <noreply@voltcompany.in>', {
      to: 'driver@example.com',
      subject: 'Volt Neo রসিদ VN/2026-27/000001',
      text: 'রসিদ সংযুক্ত।',
      attachment: {
        filename: 'receipt VN/1.pdf',
        contentType: 'application/pdf',
        content: Buffer.from('%PDF-1.4 test'),
      },
    }).toString();
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="vn_');
    expect(raw).toContain('filename="receipt_VN_1.pdf"');
    expect(raw).toContain(Buffer.from('%PDF-1.4 test').toString('base64'));
  });

  it('keeps a plain ASCII subject as it is, without an attachment part', () => {
    const raw = mime('a@b.in', {
      to: 'c@d.in',
      subject: 'Volt Neo receipt',
      text: 'Hi',
    }).toString();
    expect(raw).toContain('Subject: Volt Neo receipt');
    expect(raw).not.toContain('multipart');
  });
});
