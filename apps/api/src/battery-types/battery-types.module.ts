import { Module } from '@nestjs/common';
import { BatteryTypesController } from './battery-types.controller';
import { BatteryTypesService } from './battery-types.service';

@Module({
  controllers: [BatteryTypesController],
  providers: [BatteryTypesService],
  exports: [BatteryTypesService],
})
export class BatteryTypesModule {}
