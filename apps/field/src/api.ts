import type { Permission, StaffProfile } from '@voltneo/shared';

/**
 * Talks to the Volt Neo API as the Field App (an "app" client: the refresh
 * token comes back in the body and is kept in the phone's secure storage).
 * Online only (founder decision, 24 Oct 2026): an action with no signal fails
 * with a clear message and can be retried; repeated cash entries carry a
 * request ID so a retry is never counted twice.
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

export interface Session {
  accessToken: string;
  refreshToken: string;
  staff: StaffProfile;
  permissions: Permission[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function messageFrom(body: unknown, status: number): string {
  const b = body as { message?: unknown } | undefined;
  if (Array.isArray(b?.message)) return (b.message as unknown[]).map(String).join('. ');
  if (typeof b?.message === 'string') return b.message;
  return `Request failed (${status})`;
}

export class FieldApi {
  private access: string | null = null;
  private refreshing: Promise<Session | null> | null = null;
  private readonly fetchImpl: Fetch;

  constructor(
    private readonly opts: {
      baseUrl: string;
      store: TokenStore;
      fetch?: Fetch;
      timeoutMs?: number;
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
    } catch {
      throw new ApiError(0, 'NO_CONNECTION');
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
    await this.opts.store.set(session.refreshToken);
    return session;
  }

  async requestCode(identifier: string): Promise<void> {
    await this.parse(
      await this.raw(
        '/v1/auth/otp/request',
        { method: 'POST', body: JSON.stringify({ identifier }) },
        false,
      ),
    );
  }

  async verify(identifier: string, code: string): Promise<Session> {
    const session = await this.parse<Session>(
      await this.raw(
        '/v1/auth/otp/verify',
        { method: 'POST', body: JSON.stringify({ identifier, code }) },
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
            '/v1/auth/refresh',
            { method: 'POST', body: JSON.stringify({ refreshToken: token }) },
            false,
          );
          if (res.status === 401 || res.status === 403) {
            await this.opts.store.set(null);
            this.access = null;
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

  upload<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: form });
  }

  async signOut(): Promise<void> {
    try {
      if (this.access) await this.raw('/v1/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      /* signing out on the phone matters more than telling the server */
    }
    this.access = null;
    await this.opts.store.set(null);
  }
}
