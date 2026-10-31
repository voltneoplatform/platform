import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { AutopayModule } from '../autopay/autopay.module';
import { JobsService } from './jobs.service';

@Module({ imports: [CollectionsModule, AutopayModule], providers: [JobsService] })
export class JobsModule {}
