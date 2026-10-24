import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PaymentsModule } from '../payments/payments.module';
import { OwnershipController } from './ownership.controller';
import { OwnershipService } from './ownership.service';

@Module({
  imports: [DocumentsModule, PaymentsModule],
  controllers: [OwnershipController],
  providers: [OwnershipService],
})
export class OwnershipModule {}
