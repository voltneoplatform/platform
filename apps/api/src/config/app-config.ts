/**
 * Typed, validated configuration. The API refuses to start if a required
 * setting is missing or unsafe, rather than failing later at runtime.
 */

export type OtpDelivery = 'log' | 'memory';
/** How SMS and WhatsApp messages to drivers are delivered (no provider chosen yet). */
export type MessageDelivery = 'log' | 'memory';

/** Which gateway creates UPI payment links. "fake" is for development and tests. */
export type PaymentGatewayKind = 'none' | 'fake' | 'cashfree';

export interface CashfreeConfig {
  env: 'sandbox' | 'production';
  appId: string;
  secretKey: string;
  apiVersion: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  otpHashSecret: string;
  accessTokenTtlSeconds: number;
  sessionIdleTimeoutMinutes: number;
  /** Field App sessions end after this much inactivity (ASSUMED 240). */
  appSessionIdleTimeoutMinutes: number;
  sessionAbsoluteTimeoutHours: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpDelivery: OtpDelivery;
  adminOrigin: string;
  /** Development only: more browser origins allowed to call the API (the Field App's web preview). */
  extraOrigins: string[];
  /** 32-byte key for KYC numbers; encryption and fingerprint keys are derived from it. */
  kycEncryptionKey: Buffer;
  /** Private folder for uploaded documents (local storage adapter). */
  fileStorageDir: string;
  /** Minutes a link to a private file stays valid. */
  fileLinkTtlSeconds: number;
  messageDelivery: MessageDelivery;
  /**
   * Webhook secrets by payment provider. Only the built-in "test" provider
   * exists until the founder opens a payment gateway account.
   */
  paymentWebhookSecrets: Record<string, string>;
  paymentGateway: PaymentGatewayKind;
  cashfree: CashfreeConfig | null;
  /** Public address of this API, for gateway callbacks (e.g. https://api.voltneo.in). */
  publicApiUrl: string | null;
  /** Days a payment link stays open (ASSUMED 7). */
  paymentLinkDays: number;
  /** Run scheduled jobs (BullMQ on Redis) in this process. */
  jobsEnabled: boolean;
  redisUrl: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === '') throw new Error(`Missing required setting ${key}`);
  return value;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 1): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${key} must be a whole number ≥ ${min}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test or production`);
  }

  const jwtAccessSecret = required(env, 'JWT_ACCESS_SECRET');
  const otpHashSecret = required(env, 'OTP_HASH_SECRET');
  for (const [key, value] of [
    ['JWT_ACCESS_SECRET', jwtAccessSecret],
    ['OTP_HASH_SECRET', otpHashSecret],
  ] as const) {
    if (value.length < 32) throw new Error(`${key} must be at least 32 characters`);
    if (nodeEnv === 'production' && value.startsWith('change-me')) {
      throw new Error(`${key} still has the example value`);
    }
  }

  const kycEncryptionKey = Buffer.from(required(env, 'KYC_ENCRYPTION_KEY'), 'base64');
  if (kycEncryptionKey.length !== 32) {
    throw new Error(
      'KYC_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
    );
  }
  if (nodeEnv === 'production' && kycEncryptionKey.toString('utf8').startsWith('dev-only')) {
    throw new Error('KYC_ENCRYPTION_KEY still has the development example value');
  }

  const otpDelivery = (env.OTP_DELIVERY ?? 'log') as OtpDelivery;
  if (!['log', 'memory'].includes(otpDelivery)) {
    throw new Error('OTP_DELIVERY must be "log" or "memory" until real providers are added');
  }
  if (otpDelivery === 'memory' && nodeEnv !== 'test') {
    throw new Error('OTP_DELIVERY "memory" is for automated tests only');
  }
  const messageDelivery = (env.MESSAGE_DELIVERY ?? 'log') as MessageDelivery;
  if (!['log', 'memory'].includes(messageDelivery)) {
    throw new Error('MESSAGE_DELIVERY must be "log" or "memory" until a provider is added');
  }
  if (messageDelivery === 'memory' && nodeEnv !== 'test') {
    throw new Error('MESSAGE_DELIVERY "memory" is for automated tests only');
  }

  const paymentWebhookSecrets: Record<string, string> = {};
  const testSecret = env.PAYMENT_TEST_WEBHOOK_SECRET;
  if (testSecret) {
    if (testSecret.length < 32) {
      throw new Error('PAYMENT_TEST_WEBHOOK_SECRET must be at least 32 characters');
    }
    paymentWebhookSecrets.test = testSecret;
  }

  const paymentGateway = (env.PAYMENT_GATEWAY ||
    (nodeEnv === 'production' ? 'none' : 'fake')) as PaymentGatewayKind;
  if (!['none', 'fake', 'cashfree'].includes(paymentGateway)) {
    throw new Error('PAYMENT_GATEWAY must be "none", "fake" or "cashfree"');
  }
  if (paymentGateway === 'fake' && nodeEnv === 'production') {
    throw new Error('PAYMENT_GATEWAY "fake" is for development and tests only');
  }
  let cashfree: CashfreeConfig | null = null;
  if (paymentGateway === 'cashfree') {
    const cfEnv = (env.CASHFREE_ENV || 'sandbox') as CashfreeConfig['env'];
    if (!['sandbox', 'production'].includes(cfEnv)) {
      throw new Error('CASHFREE_ENV must be "sandbox" or "production"');
    }
    if (cfEnv === 'sandbox' && nodeEnv === 'production') {
      throw new Error('Production must use CASHFREE_ENV=production');
    }
    cashfree = {
      env: cfEnv,
      appId: required(env, 'CASHFREE_APP_ID'),
      secretKey: required(env, 'CASHFREE_SECRET_KEY'),
      apiVersion: env.CASHFREE_API_VERSION || '2026-01-01',
    };
    // Cashfree signs webhooks with the same secret key.
    paymentWebhookSecrets.cashfree = cashfree.secretKey;
  }
  const publicApiUrl = env.PUBLIC_API_URL ? env.PUBLIC_API_URL.replace(/\/+$/, '') : null;
  if (paymentGateway === 'cashfree' && !publicApiUrl?.startsWith('https://')) {
    throw new Error('PUBLIC_API_URL (https) is needed so Cashfree can report payments');
  }

  const extraOrigins =
    nodeEnv === 'production'
      ? []
      : (env.CORS_EXTRA_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  if (nodeEnv === 'production') {
    // "log" prints codes to the server log. Production must wait for a real
    // SMS/email provider adapter (founder decision, needed before M2 goes live).
    throw new Error(
      'Production needs a real SMS/email provider for OTP delivery; none is configured yet',
    );
  }

  return {
    nodeEnv,
    port: int(env, 'PORT', 4000),
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtAccessSecret,
    otpHashSecret,
    accessTokenTtlSeconds: int(env, 'ACCESS_TOKEN_TTL_SECONDS', 900, 60),
    sessionIdleTimeoutMinutes: int(env, 'SESSION_IDLE_TIMEOUT_MINUTES', 30),
    appSessionIdleTimeoutMinutes: int(env, 'APP_SESSION_IDLE_TIMEOUT_MINUTES', 240),
    sessionAbsoluteTimeoutHours: int(env, 'SESSION_ABSOLUTE_TIMEOUT_HOURS', 12),
    otpTtlSeconds: int(env, 'OTP_TTL_SECONDS', 300, 60),
    otpMaxAttempts: int(env, 'OTP_MAX_ATTEMPTS', 5),
    otpResendCooldownSeconds: int(env, 'OTP_RESEND_COOLDOWN_SECONDS', 30, 0),
    otpDelivery,
    adminOrigin: env.ADMIN_ORIGIN ?? 'http://localhost:3000',
    extraOrigins,
    kycEncryptionKey,
    fileStorageDir: env.FILE_STORAGE_DIR || './storage',
    fileLinkTtlSeconds: int(env, 'FILE_LINK_TTL_SECONDS', 300, 30),
    messageDelivery,
    paymentWebhookSecrets,
    paymentGateway,
    cashfree,
    publicApiUrl,
    paymentLinkDays: int(env, 'PAYMENT_LINK_DAYS', 7),
    jobsEnabled: env.JOBS_ENABLED === 'true',
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  };
}
