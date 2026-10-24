import { randomUUID } from 'node:crypto';
import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AppConfig, CashfreeConfig } from '../config/app-config';

/**
 * UPI payment links (spec section 7: "payment links and webhooks"). Every
 * outside service sits behind an adapter; the gateway chosen by the founder is
 * Cashfree (CONFIRMED 24 Oct 2026). A "fake" adapter serves development and
 * tests, and "none" refuses until keys are configured.
 */
export interface CreateLinkInput {
  /** Our ID, sent to the gateway and echoed back in its webhook. */
  linkId: string;
  amountPaise: number;
  purpose: string;
  customer: { phone: string; name: string };
  expiresAt: Date;
  agreementNumber: string;
}

export interface CreatedLink {
  gatewayRef: string | null;
  url: string;
}

export interface PaymentGateway {
  readonly name: 'cashfree' | 'fake' | 'none';
  createLink(input: CreateLinkInput): Promise<CreatedLink>;
  cancelLink(linkId: string): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** ₹ amount with two decimals, as Cashfree expects (paise are integers here). */
export function paiseToRupeeNumber(paise: number): number {
  return Math.round(paise) / 100;
}

/** "200.12" or 200.12 → 20012 paise, without floating-point surprises. */
export function rupeesToPaiseExact(value: string | number): number {
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Not an amount: ${s}`);
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
}

/** Indian mobile number without the +91 prefix, as gateways expect. */
export function localPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
}

/** India time with offset, e.g. 2026-10-31T23:59:59+05:30. */
export function istIso(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * 3_600_000);
  return `${t.toISOString().slice(0, 19)}+05:30`;
}

export class NoGateway implements PaymentGateway {
  readonly name = 'none' as const;
  createLink(): Promise<CreatedLink> {
    throw new ServiceUnavailableException(
      'UPI payment links are not set up yet: the Cashfree keys still need to be added to the server settings',
    );
  }
  cancelLink(): Promise<void> {
    return Promise.resolve();
  }
}

/** Development and tests: makes a pretend link; payment is simulated from the admin panel. */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;
  readonly created: CreateLinkInput[] = [];
  readonly cancelled: string[] = [];
  createLink(input: CreateLinkInput): Promise<CreatedLink> {
    this.created.push(input);
    return Promise.resolve({
      gatewayRef: `fake_${this.created.length}`,
      url: `https://pay.voltneo.test/l/${input.linkId}`,
    });
  }
  cancelLink(linkId: string): Promise<void> {
    this.cancelled.push(linkId);
    return Promise.resolve();
  }
}

type Fetch = typeof fetch;

/**
 * Cashfree Payment Links API (docs: cashfree.com/docs/api-reference/payments,
 * version 2026-01-01). Links are UPI only, for the exact amount, and Cashfree's
 * own SMS is off: Volt Neo sends its own SMS in the driver's language.
 * REQUIRES VALIDATION against the sandbox once the founder's keys exist.
 */
export class CashfreeGateway implements PaymentGateway {
  readonly name = 'cashfree' as const;
  private readonly logger = new Logger('Cashfree');
  private readonly base: string;

  constructor(
    private readonly cfg: CashfreeConfig,
    private readonly notifyUrl: string,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
  ) {
    this.base =
      cfg.env === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  }

  private async call(path: string, body: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-client-id': this.cfg.appId,
          'x-client-secret': this.cfg.secretKey,
          'x-api-version': this.cfg.apiVersion,
          'x-request-id': randomUUID(),
          'x-idempotency-key': randomUUID(),
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`Cashfree ${path} unreachable: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Cashfree could not be reached. Try again.');
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = typeof json.message === 'string' ? json.message : `HTTP ${res.status}`;
      this.logger.warn(`Cashfree ${path} refused: ${msg}`);
      throw new BadGatewayException(`Cashfree refused the request: ${msg}`);
    }
    return json;
  }

  async createLink(input: CreateLinkInput): Promise<CreatedLink> {
    const json = await this.call('/links', {
      link_id: input.linkId,
      link_amount: paiseToRupeeNumber(input.amountPaise),
      link_currency: 'INR',
      link_purpose: input.purpose.slice(0, 500),
      customer_details: {
        customer_phone: localPhone(input.customer.phone),
        customer_name: input.customer.name.slice(0, 100),
      },
      link_partial_payments: false,
      link_expiry_time: istIso(input.expiresAt),
      link_notify: { send_sms: false, send_email: false },
      link_auto_reminders: false,
      link_notes: { agreement: input.agreementNumber },
      link_meta: { notify_url: this.notifyUrl, payment_methods: 'upi' },
    });
    const url = json.link_url;
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new BadGatewayException('Cashfree did not return a payment link');
    }
    return {
      gatewayRef: json.cf_link_id === undefined ? null : String(json.cf_link_id),
      url,
    };
  }

  async cancelLink(linkId: string): Promise<void> {
    await this.call(`/links/${encodeURIComponent(linkId)}/cancel`, {});
  }
}

export function gatewayFor(config: AppConfig): PaymentGateway {
  if (config.paymentGateway === 'cashfree' && config.cashfree && config.publicApiUrl) {
    return new CashfreeGateway(
      config.cashfree,
      `${config.publicApiUrl}/v1/webhooks/payments/cashfree`,
    );
  }
  if (config.paymentGateway === 'fake') return new FakeGateway();
  return new NoGateway();
}
