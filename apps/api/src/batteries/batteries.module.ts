import { Module } from '@nestjs/common';
import { BatteryTypesModule } from '../battery-types/battery-types.module';
import { BatteriesController } from './batteries.controller';
import { BatteriesService } from './batteries.service';

@Module({
  imports: [BatteryTypesModule],
  controllers: [BatteriesController],
  providers: [BatteriesService],
})
export class BatteriesModule {}
