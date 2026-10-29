import { RoutingOtpSender, SmsOtpSender, MemoryOtpSender } from '../auth/otp-sender';
import { TEXTS } from '../documents/texts';
import type { DltRegistration } from './dlt-registration';
import { SmsGatewayHubMessageSender } from './message-sender';
import { SmsGatewayHubClient, type FetchLike } from './smsgatewayhub';

const config = { apiKey: 'secret-key-123', baseUrl: 'https://www.smsgatewayhub.com', route: '1' };

function registration(): DltRegistration {
  const none = { EN: null, BN: null, HI: null };
  return {
    entityId: '1101000000000000001',
    header: 'VLTNEO',
    templates: {
      payment_receipt: { EN: '1107000000000000001', BN: '1107000000000000002', HI: null },
      reminder: none,
      reminder_today: none,
      final_notice: none,
      immobilised: none,
      restored: none,
      ownership_transferred: none,
      ticket_received: none,
      ticket_resolved: none,
      payment_link: none,
      sign_in_code: { EN: '1107000000000000009', BN: null, HI: null },
    },
  };
}

function fakeFetch(reply: unknown, status = 200) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(new URL(url));
    return { ok: status < 400, status, text: async () => JSON.stringify(reply) };
  };
  return { fetch, calls };
}

const ok = {
  ErrorCode: '000',
  ErrorMessage: 'Success',
  JobId: '20047',
  MessageData: [{ Number: '919830012345', MessageId: 'mvHd' }],
};
const receipt = (lang: 'EN' | 'BN') =>
  TEXTS[lang].receiptSms({
    amount: '₹2,500',
    agreement: 'NOA-000123',
    date: '02/11/2026',
    receipt: 'VNR/2026-27/000123',
    balance: '₹27,500',
  });

describe('SMSGatewayHub client', () => {
  it('sends with the DLT entity, header and template, as plain text for English', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const client = new SmsGatewayHubClient(config, registration(), fetch);
    const r = await client.send({
      to: '+919830012345',
      text: receipt('EN'),
      key: 'payment_receipt',
      lang: 'EN',
    });
    expect(r.providerRef).toBe('20047:mvHd');
    const q = calls[0]!.searchParams;
    expect(calls[0]!.pathname).toBe('/api/mt/SendSMS');
    expect(Object.fromEntries(q)).toMatchObject({
      APIKey: 'secret-key-123',
      senderid: 'VLTNEO',
      channel: '2',
      DCS: '0',
      flashsms: '0',
      number: '919830012345',
      route: '1',
      EntityId: '1101000000000000001',
      dlttemplateid: '1107000000000000001',
    });
    expect(q.get('text')).toContain('Received Rs 2,500');
  });

  it('sends Bengali as Unicode and sign-in codes on the OTP channel', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const client = new SmsGatewayHubClient(config, registration(), fetch);
    await client.send({
      to: '+919830012345',
      text: receipt('BN'),
      key: 'payment_receipt',
      lang: 'BN',
    });
    expect(calls[0]!.searchParams.get('DCS')).toBe('8');
    const sms = new SmsOtpSender(client, 5);
    await sms.send({
      channel: 'SMS',
      destination: '+919830012345',
      code: '482913',
      recipientName: 'A',
    });
    expect(calls[1]!.searchParams.get('channel')).toBe('OTP');
    expect(calls[1]!.searchParams.get('text')).toBe(
      'Volt Neo: Your sign-in code is 482913. It expires in 5 minutes. Do not share it with anyone.',
    );
  });

  it('refuses before sending when a template is not approved or the text strays', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const client = new SmsGatewayHubClient(config, registration(), fetch);
    expect(client.ready('payment_receipt', 'HI')).toBe(false);
    await expect(
      client.send({ to: '+919830012345', text: receipt('EN'), key: 'payment_receipt', lang: 'HI' }),
    ).rejects.toThrow(/not approved yet/);
    await expect(
      client.send({
        to: '+919830012345',
        text: 'Volt Neo: hello',
        key: 'payment_receipt',
        lang: 'EN',
      }),
    ).rejects.toThrow(/does not match DLT template/);
    expect(calls).toHaveLength(0);
  });

  it('reports provider errors without the API key', async () => {
    const { fetch } = fakeFetch({ ErrorCode: '13', ErrorMessage: 'Invalid template text' });
    const client = new SmsGatewayHubClient(config, registration(), fetch);
    const err = await client
      .send({ to: '+919830012345', text: receipt('EN'), key: 'payment_receipt', lang: 'EN' })
      .catch((e: Error) => e);
    expect((err as Error).message).toBe('SMSGatewayHub error 13: Invalid template text');
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const err2 = await new SmsGatewayHubClient(config, registration(), down)
      .send({ to: '+919830012345', text: receipt('EN'), key: 'payment_receipt', lang: 'EN' })
      .catch((e: Error) => e);
    expect((err2 as Error).message).not.toContain('secret-key-123');
  });

  it('maps stored message templates and refuses WhatsApp', async () => {
    const { fetch, calls } = fakeFetch(ok);
    const sender = new SmsGatewayHubMessageSender(
      new SmsGatewayHubClient(config, registration(), fetch),
    );
    await sender.send({
      channel: 'SMS',
      to: '+919830012345',
      body: receipt('EN'),
      template: 'payment_receipt',
      language: 'EN',
    });
    expect(calls).toHaveLength(1);
    await expect(
      sender.send({
        channel: 'WHATSAPP',
        to: '+919830012345',
        body: 'x',
        template: 'payment_receipt',
        language: 'EN',
      }),
    ).rejects.toThrow(/WhatsApp/);
  });
});

describe('RoutingOtpSender', () => {
  it('offers only the channels it has', async () => {
    const email = new MemoryOtpSender();
    const both = new RoutingOtpSender(email, new MemoryOtpSender());
    expect([...both.channels].sort()).toEqual(['EMAIL', 'SMS']);
    const emailOnly = new RoutingOtpSender(email, null);
    expect([...emailOnly.channels]).toEqual(['EMAIL']);
    await expect(
      emailOnly.send({
        channel: 'SMS',
        destination: '+919830012345',
        code: '1',
        recipientName: 'A',
      }),
    ).rejects.toThrow(/No sender/);
  });
});
