import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [CollectionsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
