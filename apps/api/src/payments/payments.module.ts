import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CashService } from './cash.service';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [DocumentsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, CashService, WebhooksService],
})
export class PaymentsModule {}
