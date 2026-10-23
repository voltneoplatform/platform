import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { JobsService } from './jobs.service';

@Module({ imports: [CollectionsModule], providers: [JobsService] })
export class JobsModule {}
