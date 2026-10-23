import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CollectionsModule } from '../collections/collections.module';
import { CashService } from './cash.service';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [DocumentsModule, CollectionsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, CashService, WebhooksService],
})
export class PaymentsModule {}
