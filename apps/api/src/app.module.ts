import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { StaffModule } from './staff/staff.module';
import { FilesModule } from './files/files.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { BatteryTypesModule } from './battery-types/battery-types.module';
import { BatteriesModule } from './batteries/batteries.module';
import { PlansModule } from './plans/plans.module';
import { DriversModule } from './drivers/drivers.module';
import { MessagingModule } from './messaging/messaging.module';
import { AgreementsModule } from './agreements/agreements.module';
import { PaymentsModule } from './payments/payments.module';
import { ClockModule } from './common/clock';
import { CollectionsModule } from './collections/collections.module';
import { JobsModule } from './jobs/jobs.module';
import { OwnershipModule } from './ownership/ownership.module';
import { ReportsModule } from './reports/reports.module';
import { TicketsModule } from './tickets/tickets.module';
import { FieldModule } from './field/field.module';
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
    FilesModule,
    ApprovalsModule,
    BatteryTypesModule,
    BatteriesModule,
    PlansModule,
    DriversModule,
    MessagingModule,
    AgreementsModule,
    PaymentsModule,
    ClockModule,
    CollectionsModule,
    JobsModule,
    OwnershipModule,
    TicketsModule,
    ReportsModule,
    FieldModule,
  ],
  controllers: [HealthController],
  providers: [
    // Registered before the auth guard, so floods are refused before any database work.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
