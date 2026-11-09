import { Module } from '@nestjs/common';
import { DriverAuthModule } from '../driver-auth/driver-auth.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { PhoneChecksService } from './phone-checks.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [DriverAuthModule],
  controllers: [DriversController, ReferralsController],
  providers: [DriversService, PhoneChecksService, ReferralsService],
  exports: [DriversService],
})
export class DriversModule {}
