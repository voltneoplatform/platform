import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (token: string) => ({
  accessToken: token,
  accessTokenExpiresAt: new Date().toISOString(),
  staff: {
    id: 's1',
    name: 'A',
    email: 'a@x.co',
    phone: null,
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    createdAt: '',
    lastLoginAt: null,
  },
  permissions: ['admin_panel.access'],
});

describe('ApiClient', () => {
  it('marks every request as a web client and sends the access token', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => json(200, { ok: true }));
    const api = new ApiClient({ fetch: fetch as never });
    api.setAccessToken('t1');
    await api.get('/v1/staff');
    const headers = fetch.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('X-Client')).toBe('web');
    expect(headers.get('authorization')).toBe('Bearer t1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Headers).get('authorization');
      calls.push(`${url} ${auth ?? ''}`);
      if (url.endsWith('/auth/refresh')) return json(200, session('t2'));
      return auth === 'Bearer t2' ? json(200, { ok: true }) : json(401, {});
    });
    const api = new ApiClient({ fetch: fetch as never });
    api.setAccessToken('expired');
    await expect(api.get('/v1/staff')).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['/v1/staff Bearer expired', '/v1/auth/refresh ', '/v1/staff Bearer t2']);
  });

  it('shares one refresh between requests that fail together (refresh tokens are single-use)', async () => {
    let refreshes = 0;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session('t2'));
      }
      return (init.headers as Headers).get('authorization') === 'Bearer t2'
        ? json(200, {})
        : json(401, {});
    });
    const api = new ApiClient({ fetch: fetch as never });
    api.setAccessToken('expired');
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('reports a finished session when refresh fails', async () => {
    const onSessionEnded = vi.fn();
    const fetch = vi.fn(async () => json(401, { message: 'no' }));
    const api = new ApiClient({ fetch, onSessionEnded });
    await expect(api.get('/v1/staff')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it('turns API validation messages into readable errors', async () => {
    const fetch = vi.fn(async () =>
      json(400, { message: ['name must be longer', 'role is invalid'] }),
    );
    const api = new ApiClient({ fetch });
    await expect(api.post('/v1/staff', {})).rejects.toThrow('name must be longer. role is invalid');
  });

  it('downloads files with the login token, refreshing once, and reports errors', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Headers).get('authorization');
      if (url.endsWith('/auth/refresh')) return json(200, session('t2'));
      if (url.includes('missing')) return json(404, { message: 'Agreement not found' });
      return auth === 'Bearer t2'
        ? new Response('%PDF-1.3', { status: 200, headers: { 'content-type': 'application/pdf' } })
        : json(401, {});
    });
    const api = new ApiClient({ fetch: fetch as never });
    api.setAccessToken('expired');
    const blob = await api.blob('/v1/agreements/a/documents/schedule-1');
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-1.3');
    await expect(api.blob('/v1/agreements/missing/documents/schedule-1')).rejects.toMatchObject({
      status: 404,
      message: 'Agreement not found',
    });
  });
});
