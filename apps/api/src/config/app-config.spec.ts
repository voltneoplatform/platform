import { loadConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgresql://x@localhost/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  OTP_HASH_SECRET: 'b'.repeat(40),
  KYC_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.sessionIdleTimeoutMinutes).toBe(30);
    expect(c.otpMaxAttempts).toBe(5);
    expect(c.otpDelivery).toBe('log');
  });

  it('refuses short or missing secrets', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...base, OTP_HASH_SECRET: '' })).toThrow(/Missing/);
  });

  it('needs a 32-byte KYC encryption key', () => {
    expect(() => loadConfig({ ...base, KYC_ENCRYPTION_KEY: '' })).toThrow(/Missing/);
    expect(() =>
      loadConfig({ ...base, KYC_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/32 bytes/);
    expect(loadConfig({ ...base }).kycEncryptionKey).toHaveLength(32);
  });

  it('allows in-memory OTP delivery only in tests', () => {
    expect(() => loadConfig({ ...base, OTP_DELIVERY: 'memory' })).toThrow(/automated tests/);
    expect(loadConfig({ ...base, NODE_ENV: 'test', OTP_DELIVERY: 'memory' }).otpDelivery).toBe(
      'memory',
    );
  });

  it('refuses to start in production without a real OTP provider', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /real SMS\/email provider/,
    );
  });

  it('refuses example secrets in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-' + 'x'.repeat(30),
      }),
    ).toThrow(/example value/);
  });
});
