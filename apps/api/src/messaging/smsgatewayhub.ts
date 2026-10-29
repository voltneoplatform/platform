import type { SmsGatewayHubConfig } from '../config/app-config';
import type { Lang } from '../documents/texts';
import type { DltRegistration } from './dlt-registration';
import { DLT_TEMPLATES, isUnicode, matchesTemplate, type DltKey } from './sms-templates';

/** The parts of fetch this client uses, so tests can pass a stand-in. */
export type FetchLike = (
  url: string,
  init: { method: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface SmsSend {
  /** +91XXXXXXXXXX */
  to: string;
  text: string;
  key: DltKey;
  lang: Lang;
  /** Sign-in codes go on SMSGatewayHub's OTP channel. */
  otp?: boolean;
}

/**
 * SMSGatewayHub classic SMS API (GET /api/mt/SendSMS), as documented in the
 * provider's API guide and official SDK. Each SMS carries the DLT entity and
 * template IDs. Sending is not retried here: a send that may have gone out is
 * never repeated automatically; the message is marked failed and can be resent.
 */
export class SmsGatewayHubClient {
  private readonly fetch: FetchLike;

  constructor(
    private readonly config: SmsGatewayHubConfig,
    private readonly dlt: DltRegistration,
    fetchImpl?: FetchLike,
  ) {
    this.fetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** Whether a template can be sent now (approved on DLT and the IDs are filled in). */
  ready(key: DltKey, lang: Lang): boolean {
    return Boolean(this.dlt.entityId && this.dlt.header && this.dlt.templates[key][lang]);
  }

  async send(m: SmsSend): Promise<{ providerRef: string }> {
    const templateId = this.dlt.templates[m.key][m.lang];
    if (!this.dlt.entityId || !this.dlt.header || !templateId) {
      throw new Error(`DLT template not approved yet: ${m.key} (${m.lang})`);
    }
    if (!matchesTemplate(m.text, m.key, m.lang)) {
      throw new Error(
        `Text does not match DLT template ${m.key} (${m.lang}): "${DLT_TEMPLATES[m.key].name}"`,
      );
    }
    const number = m.to.replace(/^\+/, '');
    if (!/^91[6-9]\d{9}$/.test(number)) throw new Error('Not an Indian mobile number');

    const q = new URLSearchParams({
      APIKey: this.config.apiKey,
      senderid: this.dlt.header,
      channel: m.otp ? 'OTP' : '2',
      DCS: isUnicode(m.text) ? '8' : '0',
      flashsms: '0',
      number,
      text: m.text,
      route: this.config.route,
      EntityId: this.dlt.entityId,
      dlttemplateid: templateId,
    });
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.fetch(`${this.config.baseUrl}/api/mt/SendSMS?${q.toString()}`, {
        method: 'GET',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Never include the URL or the original error, which can carry it (and the API key).
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`SMSGatewayHub unreachable: ${(err as Error).name}`);
    }
    const raw = await res.text();
    let body: {
      ErrorCode?: string;
      ErrorMessage?: string;
      JobId?: string | number;
      MessageData?: { Number?: string; MessageId?: string }[];
    };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`SMSGatewayHub answered HTTP ${res.status} without JSON`);
    }
    const code = String(body.ErrorCode ?? '');
    if (!res.ok || (code !== '000' && code !== '0')) {
      throw new Error(
        `SMSGatewayHub error ${code || res.status}: ${body.ErrorMessage ?? 'unknown'}`,
      );
    }
    const messageId = body.MessageData?.[0]?.MessageId ?? '';
    return { providerRef: `${body.JobId ?? ''}:${messageId}` };
  }
}
