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

  describe('hosted servers', () => {
    const hosted = {
      ...base,
      NODE_ENV: 'production',
      DEPLOYMENT: 'staging',
      OTP_DELIVERY: 'ses',
      SES_FROM: 'Volt Neo <no-reply@voltcompany.in>',
      SES_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      SES_SECRET_ACCESS_KEY: 'x'.repeat(40),
      FILE_STORAGE: 's3',
      S3_BUCKET: 'voltneo-files',
      S3_ACCESS_KEY_ID: 'AKIAEXAMPLE2',
      S3_SECRET_ACCESS_KEY: 'y'.repeat(40),
    };

    it('starts the test site with email codes, S3 files and logged driver messages', () => {
      const c = loadConfig(hosted);
      expect(c.deployment).toBe('staging');
      expect(c.ses?.region).toBe('ap-south-1');
      expect(c.fileStorage).toMatchObject({
        kind: 's3',
        bucket: 'voltneo-files',
        region: 'ap-south-1',
      });
      expect(c.messageDelivery).toBe('log');
      expect(c.paymentGateway).toBe('none');
    });

    it('needs DEPLOYMENT to match NODE_ENV', () => {
      expect(() => loadConfig({ ...hosted, DEPLOYMENT: '' })).toThrow(/staging or production/);
      expect(() => loadConfig({ ...base, DEPLOYMENT: 'staging' })).toThrow(/NODE_ENV=production/);
    });

    it('refuses codes in the log and files on the server disk', () => {
      expect(() => loadConfig({ ...hosted, OTP_DELIVERY: 'log' })).toThrow(/OTP_DELIVERY=ses/);
      expect(() => loadConfig({ ...hosted, FILE_STORAGE: 'local' })).toThrow(/FILE_STORAGE=s3/);
      expect(() => loadConfig({ ...hosted, SES_FROM: '' })).toThrow(/SES_FROM/);
    });

    it('keeps production waiting for an SMS provider', () => {
      expect(() => loadConfig({ ...hosted, DEPLOYMENT: 'production' })).toThrow(
        /real SMS\/WhatsApp provider/,
      );
    });

    it('sends SMS through SMSGatewayHub when its key is set', () => {
      expect(() => loadConfig({ ...hosted, MESSAGE_DELIVERY: 'smsgatewayhub' })).toThrow(
        /SMSGATEWAYHUB_API_KEY/,
      );
      const c = loadConfig({
        ...hosted,
        MESSAGE_DELIVERY: 'smsgatewayhub',
        SMSGATEWAYHUB_API_KEY: 'k'.repeat(20),
      });
      expect(c.smsGatewayHub).toEqual({
        apiKey: 'k'.repeat(20),
        baseUrl: 'https://www.smsgatewayhub.com',
        route: '1',
      });
      // With a real SMS provider, production no longer waits on driver messages.
      expect(() =>
        loadConfig({
          ...hosted,
          DEPLOYMENT: 'production',
          MESSAGE_DELIVERY: 'smsgatewayhub',
          SMSGATEWAYHUB_API_KEY: 'k'.repeat(20),
        }),
      ).not.toThrow(/SMS\/WhatsApp provider/);
    });

    it('allows only Cashfree sandbox on the test site', () => {
      const cf = {
        ...hosted,
        PAYMENT_GATEWAY: 'cashfree',
        CASHFREE_APP_ID: 'TEST123',
        CASHFREE_SECRET_KEY: 'cfsk_test',
        PUBLIC_API_URL: 'https://api.voltcompany.in',
      };
      expect(loadConfig(cf).cashfree?.env).toBe('sandbox');
      expect(() => loadConfig({ ...cf, CASHFREE_ENV: 'production' })).toThrow(
        /only with DEPLOYMENT=production/,
      );
    });
  });

  it('refuses example secrets in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DEPLOYMENT: 'staging',
        JWT_ACCESS_SECRET: 'change-me-' + 'x'.repeat(30),
      }),
    ).toThrow(/example value/);
  });
});
