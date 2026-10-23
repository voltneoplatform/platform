import 'dotenv/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDb =
  process.env.TEST_DATABASE_URL ?? 'postgresql://voltneo:voltneo@localhost:5432/voltneo_test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: testDb,
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123',
  OTP_HASH_SECRET: 'test-otp-secret-test-otp-secret-0123456789',
  OTP_DELIVERY: 'memory',
  MESSAGE_DELIVERY: 'memory',
  PAYMENT_TEST_WEBHOOK_SECRET: 'test-webhook-secret-test-webhook-secret-01',
  KYC_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  FILE_STORAGE_DIR: join(tmpdir(), `voltneo-test-files-${process.pid}`),
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  THROTTLE_DISABLED: 'true',
  ADMIN_ORIGIN: 'http://localhost:3000',
});
