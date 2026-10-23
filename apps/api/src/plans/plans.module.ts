import { Module } from '@nestjs/common';
import { BatteryTypesModule } from '../battery-types/battery-types.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [BatteryTypesModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
