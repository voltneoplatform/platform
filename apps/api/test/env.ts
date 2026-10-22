import 'dotenv/config';

const testDb =
  process.env.TEST_DATABASE_URL ?? 'postgresql://voltneo:voltneo@localhost:5432/voltneo_test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: testDb,
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123',
  OTP_HASH_SECRET: 'test-otp-secret-test-otp-secret-0123456789',
  OTP_DELIVERY: 'memory',
  OTP_RESEND_COOLDOWN_SECONDS: '0',
  THROTTLE_DISABLED: 'true',
  ADMIN_ORIGIN: 'http://localhost:3000',
});
