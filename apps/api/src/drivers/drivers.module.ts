import { Module } from '@nestjs/common';
import { DriverAuthModule } from '../driver-auth/driver-auth.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { PhoneChecksService } from './phone-checks.service';

@Module({
  imports: [DriverAuthModule],
  controllers: [DriversController],
  providers: [DriversService, PhoneChecksService],
  exports: [DriversService],
})
export class DriversModule {}
