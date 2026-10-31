/**
 * Talks to the Volt Neo API as the Driver App (M6). The driver signs in with a
 * code sent to their registered mobile number; the refresh token is kept in the
 * phone's secure storage. Online only: an action without signal fails with a
 * clear message and can be tried again.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** No answer from the server: no signal or the server is unreachable. */
  get offline(): boolean {
    return this.status === 0;
  }
  get code(): string | undefined {
    const b = this.body as { code?: unknown } | undefined;
    return typeof b?.code === 'string' ? b.code : undefined;
  }
}

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

export type DriverLang = 'BN' | 'HI' | 'EN';

export interface DriverProfile {
  id: string;
  name: string;
  language: DriverLang;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  driver: DriverProfile;
}

/** After the code: signed in, or a shared phone where the driver picks their name. */
export type VerifyResult =
  { session: Session } | { choose: { id: string; name: string }[]; selectToken: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** When a sign-in token (JWT) expires, in ms since 1970; null if it cannot be read. */
export function tokenExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  let bits = 0;
  let value = 0;
  let text = '';
  for (const ch of part.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  try {
    const exp = (JSON.parse(text) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Renew the sign-in token this long before it expires, so a request is never refused midway. */
const RENEW_BEFORE_MS = 60_000;

function messageFrom(body: unknown, status: number): string {
  const b = body as { message?: unknown } | undefined;
  if (Array.isArray(b?.message)) return (b.message as unknown[]).map(String).join('. ');
  if (typeof b?.message === 'string') return b.message;
  return `Request failed (${status})`;
}

export class DriverApi {
  private access: string | null = null;
  private accessExpiresAt: number | null = null;
  private refreshing: Promise<Session | null> | null = null;
  private readonly fetchImpl: Fetch;

  constructor(
    private readonly opts: {
      baseUrl: string;
      store: TokenStore;
      fetch?: Fetch;
      timeoutMs?: number;
      now?: () => number;
      onSessionEnded?: () => void;
    },
  ) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private async raw(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (typeof init.body === 'string') headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    if (auth && this.access) headers.set('authorization', `Bearer ${this.access}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      return await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      // Kept for the error notice, so a field report says what the phone saw.
      throw new ApiError(0, 'NO_CONNECTION', { detail: String(err).slice(0, 200) });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status), body);
    return body as T;
  }

  private async keep(session: Session): Promise<Session> {
    this.access = session.accessToken;
    this.accessExpiresAt = tokenExpiry(session.accessToken);
    await this.opts.store.set(session.refreshToken);
    return session;
  }

  async requestCode(phone: string): Promise<void> {
    await this.parse(
      await this.raw(
        '/v1/driver-auth/code/request',
        { method: 'POST', body: JSON.stringify({ phone }) },
        false,
      ),
    );
  }

  async verify(phone: string, code: string): Promise<VerifyResult> {
    const result = await this.parse<VerifyResult>(
      await this.raw(
        '/v1/driver-auth/code/verify',
        { method: 'POST', body: JSON.stringify({ phone, code }) },
        false,
      ),
    );
    if ('session' in result) await this.keep(result.session);
    return result;
  }

  /** A shared phone: the driver picked their name. */
  async select(selectToken: string, driverId: string): Promise<Session> {
    const session = await this.parse<Session>(
      await this.raw(
        '/v1/driver-auth/select',
        { method: 'POST', body: JSON.stringify({ selectToken, driverId }) },
        false,
      ),
    );
    return this.keep(session);
  }

  /** Renews the session with the stored refresh token; null when there is none or it ended. */
  restore(): Promise<Session | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const token = await this.opts.store.get();
          if (!token) return null;
          const res = await this.raw(
            '/v1/driver-auth/refresh',
            { method: 'POST', body: JSON.stringify({ refreshToken: token }) },
            false,
          );
          if (res.status === 401 || res.status === 403) {
            await this.opts.store.set(null);
            this.access = null;
            this.accessExpiresAt = null;
            return null;
          }
          return this.keep(await this.parse<Session>(res));
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    // An expired token is refused before the server reads the body; for a photo
    // upload that breaks the connection mid-send. Renew it first instead.
    const now = this.opts.now?.() ?? Date.now();
    if (
      this.access &&
      this.accessExpiresAt !== null &&
      this.accessExpiresAt - now < RENEW_BEFORE_MS
    ) {
      await this.restore();
    }
    let res = await this.raw(path, init);
    if (res.status === 401) {
      const session = await this.restore();
      if (!session) {
        this.opts.onSessionEnded?.();
        throw new ApiError(401, 'SESSION_ENDED');
      }
      res = await this.raw(path, init);
    }
    return this.parse<T>(res);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  /** The current sign-in token, for downloading a PDF with the phone's file tools. */
  async token(): Promise<string | null> {
    const now = this.opts.now?.() ?? Date.now();
    if (
      !this.access ||
      (this.accessExpiresAt !== null && this.accessExpiresAt - now < RENEW_BEFORE_MS)
    ) {
      await this.restore();
    }
    return this.access;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async signOut(): Promise<void> {
    try {
      if (this.access) await this.raw('/v1/driver-auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* signing out on the phone matters more than telling the server */
    }
    this.access = null;
    this.accessExpiresAt = null;
    await this.opts.store.set(null);
  }
}
