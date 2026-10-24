import { describe, expect, it, vi } from 'vitest';
import { ApiError, FieldApi, type TokenStore } from './api';

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(v) {
      this.value = v;
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  staff: { id: 's1', name: 'Rakesh', role: 'FIELD_AGENT' },
  permissions: ['field_app.access'],
});

describe('Field App API client', () => {
  it('signs in as an app client and keeps the refresh token', async () => {
    const store = memoryStore();
    const calls: { url: string; init?: RequestInit }[] = [];
    const api = new FieldApi({
      baseUrl: 'https://api.test',
      store,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return json(200, session(1));
      },
    });
    await api.verify('agent@voltneo.example', '123456');
    expect(store.value).toBe('refresh-1');
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get('x-client')).toBeNull(); // not "web": the token comes in the body
    expect(calls[0]!.url).toBe('https://api.test/v1/auth/otp/verify');
  });

  it('renews an expired access token once and retries the request', async () => {
    const store = memoryStore('refresh-1');
    let refreshes = 0;
    const api = new FieldApi({
      baseUrl: '',
      store,
      fetch: async (url, init) => {
        if (url.endsWith('/v1/auth/refresh')) {
          refreshes++;
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-1' });
          return json(200, session(2));
        }
        const auth = new Headers(init?.headers).get('authorization');
        return auth === 'Bearer access-2' ? json(200, { ok: true }) : json(401, {});
      },
    });
    const [a, b] = await Promise.all([api.get('/v1/x'), api.get('/v1/y')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect(store.value).toBe('refresh-2');
  });

  it('ends the session when the refresh token is refused', async () => {
    const store = memoryStore('old');
    const ended = vi.fn();
    const api = new FieldApi({
      baseUrl: '',
      store,
      onSessionEnded: ended,
      fetch: async () => json(401, { message: 'Session ended' }),
    });
    await expect(api.get('/v1/x')).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it('reports no connection distinctly, and passes the server’s message on', async () => {
    const offline = new FieldApi({
      baseUrl: '',
      store: memoryStore(),
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const err = (await offline.requestCode('x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.offline).toBe(true);

    const refused = new FieldApi({
      baseUrl: '',
      store: memoryStore(),
      fetch: async () =>
        json(422, { message: 'That is more than the ₹500 still owed', code: 'OVERPAYMENT' }),
    });
    const e2 = (await refused.post('/v1/payments', {}).catch((e: unknown) => e)) as ApiError;
    expect(e2.message).toBe('That is more than the ₹500 still owed');
    expect(e2.code).toBe('OVERPAYMENT');
  });
});
