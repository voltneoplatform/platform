import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { DocumentsModule } from '../documents/documents.module';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';

@Module({
  imports: [DriversModule, DocumentsModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
