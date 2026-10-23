import type { AuthSession } from '@voltneo/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface ApiClientOptions {
  fetch?: Fetch;
  baseUrl?: string;
  onSessionEnded?: () => void;
  onSession?: (session: AuthSession) => void;
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
  }
  return status >= 500
    ? 'Something went wrong on the server. Try again.'
    : `Request failed (${status})`;
}

/**
 * Talks to the Volt Neo API. The access token lives only in memory; the
 * refresh token is an httpOnly cookie the browser sends to /v1/auth. On a 401
 * the client refreshes once (shared by all requests waiting at that moment,
 * because refresh tokens are single-use) and retries.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthSession | null> | null = null;
  private readonly fetchImpl: Fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: ApiClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = opts.baseUrl ?? '';
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  private async raw(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('X-Client', 'web');
    // FormData sets its own multipart content type, with the boundary.
    if (typeof init.body === 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (auth && this.accessToken) headers.set('authorization', `Bearer ${this.accessToken}`);
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status), body);
    return body as T;
  }

  /** Restores or renews the session using the refresh cookie. Returns null if there is none. */
  refresh(): Promise<AuthSession | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const res = await this.raw('/v1/auth/refresh', { method: 'POST', body: '{}' }, false);
          if (!res.ok) {
            this.accessToken = null;
            return null;
          }
          const session = (await res.json()) as AuthSession;
          this.accessToken = session.accessToken;
          this.opts.onSession?.(session);
          return session;
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
      const session = await this.refresh();
      if (!session) {
        this.opts.onSessionEnded?.();
        throw new ApiError(401, 'Your session has ended. Please log in again.');
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

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  upload<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: form });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  /** Login steps never trigger a refresh. */
  async publicPost<T>(path: string, body: unknown): Promise<T> {
    const res = await this.raw(path, { method: 'POST', body: JSON.stringify(body) }, false);
    return this.parse<T>(res);
  }
}
