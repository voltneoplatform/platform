import { describe, expect, it } from 'vitest';
import { ApiError, DriverApi, type TokenStore } from './api';

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
  driver: { id: 'd1', name: 'Ramesh Das', language: 'BN' },
});

describe('Driver App API client', () => {
  it('signs in with the phone code and keeps the refresh token', async () => {
    const store = memoryStore();
    const urls: string[] = [];
    const api = new DriverApi({
      baseUrl: 'https://api.test',
      store,
      fetch: async (url) => {
        urls.push(url);
        return json(200, { session: session(1) });
      },
    });
    const r = await api.verify('9830011111', '123456');
    expect('session' in r && r.session.driver.name).toBe('Ramesh Das');
    expect(urls).toEqual(['https://api.test/v1/driver-auth/code/verify']);
    expect(store.value).toBe('refresh-1');
  });

  it('asks a shared phone to pick a name before keeping anything', async () => {
    const store = memoryStore();
    const api = new DriverApi({
      baseUrl: 'https://api.test',
      store,
      fetch: async (url) =>
        url.endsWith('/verify')
          ? json(200, {
              choose: [
                { id: 'd1', name: 'Ramesh' },
                { id: 'd2', name: 'Suresh' },
              ],
              selectToken: 'pick',
            })
          : json(200, session(2)),
    });
    const r = await api.verify('9830011111', '123456');
    expect('choose' in r && r.choose).toHaveLength(2);
    expect(store.value).toBeNull();
    await api.select('pick', 'd2');
    expect(store.value).toBe('refresh-2');
  });

  it('renews an expired sign-in once and repeats the request', async () => {
    const store = memoryStore('refresh-1');
    const urls: string[] = [];
    let first = true;
    const api = new DriverApi({
      baseUrl: 'https://api.test',
      store,
      fetch: async (url) => {
        urls.push(url);
        if (url.endsWith('/v1/me') && first) {
          first = false;
          return json(401, { message: 'Login required' });
        }
        if (url.endsWith('/refresh')) return json(200, session(3));
        return json(200, { ok: true });
      },
    });
    await expect(api.get('/v1/me')).resolves.toEqual({ ok: true });
    expect(urls.map((u) => u.replace('https://api.test', ''))).toEqual([
      '/v1/me',
      '/v1/driver-auth/refresh',
      '/v1/me',
    ]);
    expect(store.value).toBe('refresh-3');
  });

  it('reports no signal as an offline error', async () => {
    const api = new DriverApi({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const err = await api.requestCode('9830011111').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).offline).toBe(true);
  });
});
