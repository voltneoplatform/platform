import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Role } from '@voltneo/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { MemoryOtpSender, OTP_SENDER } from '../src/auth/otp-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { MESSAGE_SENDER, MemoryMessageSender } from '../src/messaging/message-sender';
import { CLOCK, TestClock } from '../src/common/clock';

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  otp: MemoryOtpSender;
  messages: MemoryMessageSender;
  clock: TestClock;
}

export async function createTestApp(
  configure: (b: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<TestContext> {
  const moduleRef = await configure(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'], rawBody: true });
  configureApp(app);
  await app.init();
  return {
    app,
    http: request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    otp: app.get<MemoryOtpSender>(OTP_SENDER),
    messages: app.get<MemoryMessageSender>(MESSAGE_SENDER),
    clock: app.get<TestClock>(CLOCK),
  };
}

/** Clears all data between tests. The audit log's truncate guard is paused only for this cleanup. */
export async function resetData(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE "audit_log" DISABLE TRIGGER USER');
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "audit_log", "staff_sessions", "staff_otp_challenges", "staff_users",
        "approval_requests", "battery_custody", "batteries", "plan_version_prices", "plan_versions",
        "plans", "battery_type_costs", "battery_types", "kyc_documents", "vehicles", "drivers",
        "counters", "webhook_events", "outbound_messages", "ledger_entries", "ledger_journals",
        "cash_deposits", "payment_allocations", "payments", "installation_photos", "installations",
        "agreement_events", "late_fee_accruals", "instalments", "agreements",
        "immobilisation_log", "recovery_photos", "recoveries", "collection_notices", "job_runs",
        "ticket_photos", "ticket_visits", "battery_replacements", "service_tickets",
        "ownership_transfers", "payment_links", "driver_sessions", "driver_otp_challenges",
        "autopay_charges", "autopay_mandates"
        RESTART IDENTITY CASCADE`,
    );
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "audit_log" ENABLE TRIGGER USER');
  }
}

let counter = 0;

export async function createStaff(
  prisma: PrismaService,
  role: Role,
  overrides: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    status?: 'ACTIVE' | 'DEACTIVATED';
  } = {},
) {
  counter += 1;
  return prisma.staffUser.create({
    data: {
      name: overrides.name ?? `${role} ${counter}`,
      email:
        overrides.email === undefined
          ? `${role.toLowerCase()}.${counter}@voltneo.test`
          : overrides.email,
      phone: overrides.phone ?? null,
      role,
      status: overrides.status ?? 'ACTIVE',
    },
  });
}

export async function login(
  ctx: TestContext,
  identifier: string,
  opts: { web?: boolean } = {},
): Promise<{
  accessToken: string;
  refreshToken?: string;
  cookie?: string;
  body: Record<string, unknown>;
}> {
  await ctx.http.post('/v1/auth/otp/request').send({ identifier }).expect(202);
  const destination = ctx.otp.sent.at(-1)?.destination;
  const code = destination ? ctx.otp.lastCodeFor(destination) : undefined;
  if (!code) throw new Error(`No OTP was sent for ${identifier}`);
  const req = request(ctx.app.getHttpServer()).post('/v1/auth/otp/verify');
  if (opts.web) req.set('X-Client', 'web');
  const res = await req.send({ identifier, code }).expect(200);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    cookie: setCookie?.find((c) => c.startsWith('vn_refresh='))?.split(';')[0],
    body: res.body,
  };
}

export async function loginAs(ctx: TestContext, role: Role) {
  const staff = await createStaff(ctx.prisma, role);
  const session = await login(ctx, staff.email!);
  return { staff, token: session.accessToken, session };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
