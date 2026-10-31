/**
 * Typed, validated configuration. The API refuses to start if a required
 * setting is missing or unsafe, rather than failing later at runtime.
 */

/** "ses" emails codes through AWS SES (staff who sign in with email). SMS needs a provider. */
export type OtpDelivery = 'log' | 'memory' | 'ses';
/** Where the server runs. "staging" is the hosted test site; only NODE_ENV=production uses it. */
export type Deployment = 'local' | 'staging' | 'production';
/** How SMS to drivers (and staff sign-in codes by SMS) are delivered. */
export type MessageDelivery = 'log' | 'memory' | 'smsgatewayhub';

/** SMSGatewayHub account (founder decision 29 Oct 2026). The DLT IDs live in dlt-registration.ts. */
export interface SmsGatewayHubConfig {
  apiKey: string;
  baseUrl: string;
  /** Route ID from the SMSGatewayHub panel. */
  route: string;
}

/** Which gateway creates UPI payment links. "fake" is for development and tests. */
export type PaymentGatewayKind = 'none' | 'fake' | 'cashfree';

export interface CashfreeConfig {
  env: 'sandbox' | 'production';
  appId: string;
  secretKey: string;
  apiVersion: string;
}

export interface SesConfig {
  region: string;
  /** e.g. "Volt Neo <no-reply@voltcompany.in>" */
  from: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type FileStorageConfig =
  | { kind: 'local'; dir: string }
  | {
      kind: 's3';
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      /** Only for S3-compatible test servers; AWS needs none. */
      endpoint: string | null;
    };

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  deployment: Deployment;
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
  /** Where uploaded documents live: the local folder, or a private S3 bucket. */
  fileStorage: FileStorageConfig;
  ses: SesConfig | null;
  smsGatewayHub: SmsGatewayHubConfig | null;
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
  /** Driver App sessions end after this many days without use (ASSUMED 30). */
  driverSessionIdleDays: number;
  /** Driver App sessions end this many days after sign-in at the latest (ASSUMED 90). */
  driverSessionMaxDays: number;
  /**
   * Test site only: while driver sign-in codes cannot go by SMS (DLT templates
   * not approved), they are emailed here so the founder can try the Driver App.
   */
  driverCodeTestEmail: string | null;
  /**
   * Email Cashfree requires on each UPI AutoPay mandate (drivers have none):
   * a Volt Neo mailbox chosen by the founder. Without it AutoPay stays off.
   */
  autopayCustomerEmail: string | null;
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

  const deployment = (env.DEPLOYMENT || 'local') as Deployment;
  if (!['local', 'staging', 'production'].includes(deployment)) {
    throw new Error('DEPLOYMENT must be local, staging or production');
  }
  if (nodeEnv === 'production' && deployment === 'local') {
    throw new Error('Set DEPLOYMENT to staging or production when NODE_ENV=production');
  }
  if (nodeEnv !== 'production' && deployment !== 'local') {
    throw new Error(`DEPLOYMENT=${deployment} needs NODE_ENV=production`);
  }

  const otpDelivery = (env.OTP_DELIVERY ?? 'log') as OtpDelivery;
  if (!['log', 'memory', 'ses'].includes(otpDelivery)) {
    throw new Error('OTP_DELIVERY must be "log", "memory" or "ses"');
  }
  if (otpDelivery === 'log' && nodeEnv === 'production') {
    // "log" prints codes to the server log: never on a hosted server.
    throw new Error(
      'A hosted server needs OTP_DELIVERY=ses (email codes); "log" is for development',
    );
  }
  let ses: SesConfig | null = null;
  if (otpDelivery === 'ses') {
    ses = {
      region: env.SES_REGION || 'ap-south-1',
      from: required(env, 'SES_FROM'),
      accessKeyId: required(env, 'SES_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'SES_SECRET_ACCESS_KEY'),
    };
  }
  if (otpDelivery === 'memory' && nodeEnv !== 'test') {
    throw new Error('OTP_DELIVERY "memory" is for automated tests only');
  }
  const messageDelivery = (env.MESSAGE_DELIVERY ?? 'log') as MessageDelivery;
  if (!['log', 'memory', 'smsgatewayhub'].includes(messageDelivery)) {
    throw new Error('MESSAGE_DELIVERY must be "log", "memory" or "smsgatewayhub"');
  }
  const smsGatewayHub: SmsGatewayHubConfig | null =
    messageDelivery === 'smsgatewayhub'
      ? {
          apiKey: required(env, 'SMSGATEWAYHUB_API_KEY'),
          baseUrl: (env.SMSGATEWAYHUB_BASE_URL || 'https://www.smsgatewayhub.com').replace(
            /\/+$/,
            '',
          ),
          route: env.SMSGATEWAYHUB_ROUTE || '1',
        }
      : null;
  if (messageDelivery === 'memory' && nodeEnv !== 'test') {
    throw new Error('MESSAGE_DELIVERY "memory" is for automated tests only');
  }
  if (messageDelivery === 'log' && deployment === 'production') {
    // Receipts and reminders must reach drivers (D16); the test site only logs them.
    throw new Error(
      'Production needs a real SMS/WhatsApp provider for driver messages; none is configured yet',
    );
  }

  const storageKind = env.FILE_STORAGE || 'local';
  if (!['local', 's3'].includes(storageKind)) throw new Error('FILE_STORAGE must be local or s3');
  if (storageKind === 'local' && nodeEnv === 'production') {
    throw new Error('A hosted server needs FILE_STORAGE=s3 (the server disk is not backed up)');
  }
  const fileStorageDir = env.FILE_STORAGE_DIR || './storage';
  const fileStorage: FileStorageConfig =
    storageKind === 's3'
      ? {
          kind: 's3',
          bucket: required(env, 'S3_BUCKET'),
          region: env.S3_REGION || 'ap-south-1',
          accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
          secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
          endpoint: env.S3_ENDPOINT || null,
        }
      : { kind: 'local', dir: fileStorageDir };

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
    if (cfEnv === 'sandbox' && deployment === 'production') {
      throw new Error('Production must use CASHFREE_ENV=production');
    }
    if (cfEnv === 'production' && deployment !== 'production') {
      // Real money only moves on the production server, never on the test site.
      throw new Error('CASHFREE_ENV=production is allowed only with DEPLOYMENT=production');
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

  const driverCodeTestEmail = env.DRIVER_CODE_TEST_EMAIL?.trim() || null;
  if (driverCodeTestEmail && deployment === 'production') {
    throw new Error('DRIVER_CODE_TEST_EMAIL is for the test site only');
  }
  if (driverCodeTestEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(driverCodeTestEmail)) {
    throw new Error('DRIVER_CODE_TEST_EMAIL must be an email address');
  }

  const autopayCustomerEmail = env.AUTOPAY_CUSTOMER_EMAIL?.trim() || null;
  if (autopayCustomerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(autopayCustomerEmail)) {
    throw new Error('AUTOPAY_CUSTOMER_EMAIL must be an email address');
  }

  const extraOrigins =
    nodeEnv === 'production'
      ? []
      : (env.CORS_EXTRA_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

  return {
    nodeEnv,
    deployment,
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
    fileStorageDir,
    fileStorage,
    ses,
    smsGatewayHub,
    fileLinkTtlSeconds: int(env, 'FILE_LINK_TTL_SECONDS', 300, 30),
    messageDelivery,
    paymentWebhookSecrets,
    paymentGateway,
    cashfree,
    publicApiUrl,
    paymentLinkDays: int(env, 'PAYMENT_LINK_DAYS', 7),
    jobsEnabled: env.JOBS_ENABLED === 'true',
    redisUrl: env.REDIS_URL || 'redis://localhost:6379',
    driverSessionIdleDays: int(env, 'DRIVER_SESSION_IDLE_DAYS', 30),
    driverSessionMaxDays: int(env, 'DRIVER_SESSION_MAX_DAYS', 90),
    driverCodeTestEmail,
    autopayCustomerEmail,
  };
}
