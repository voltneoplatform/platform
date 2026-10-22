/**
 * Typed, validated configuration. The API refuses to start if a required
 * setting is missing or unsafe, rather than failing later at runtime.
 */

export type OtpDelivery = 'log' | 'memory';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  otpHashSecret: string;
  accessTokenTtlSeconds: number;
  sessionIdleTimeoutMinutes: number;
  sessionAbsoluteTimeoutHours: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpDelivery: OtpDelivery;
  adminOrigin: string;
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

  const otpDelivery = (env.OTP_DELIVERY ?? 'log') as OtpDelivery;
  if (!['log', 'memory'].includes(otpDelivery)) {
    throw new Error('OTP_DELIVERY must be "log" or "memory" until real providers are added');
  }
  if (otpDelivery === 'memory' && nodeEnv !== 'test') {
    throw new Error('OTP_DELIVERY "memory" is for automated tests only');
  }
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
    sessionAbsoluteTimeoutHours: int(env, 'SESSION_ABSOLUTE_TIMEOUT_HOURS', 12),
    otpTtlSeconds: int(env, 'OTP_TTL_SECONDS', 300, 60),
    otpMaxAttempts: int(env, 'OTP_MAX_ATTEMPTS', 5),
    otpResendCooldownSeconds: int(env, 'OTP_RESEND_COOLDOWN_SECONDS', 30, 0),
    otpDelivery,
    adminOrigin: env.ADMIN_ORIGIN ?? 'http://localhost:3000',
  };
}
