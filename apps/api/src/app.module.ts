import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      // Lets most automated tests run without hitting rate limits. Ignored outside tests.
      skipIf: () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_DISABLED === 'true',
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    StaffModule,
  ],
  controllers: [HealthController],
  providers: [
    // Registered before the auth guard, so floods are refused before any database work.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
