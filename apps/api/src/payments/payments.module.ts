import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CollectionsModule } from '../collections/collections.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CashService } from './cash.service';
import { PAYMENT_GATEWAY, gatewayFor } from './gateway';
import { PaymentLinksController } from './payment-links.controller';
import { PaymentLinksService } from './payment-links.service';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [DocumentsModule, CollectionsModule],
  controllers: [PaymentsController, WebhooksController, PaymentLinksController],
  providers: [
    PaymentsService,
    CashService,
    WebhooksService,
    PaymentLinksService,
    { provide: PAYMENT_GATEWAY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => gatewayFor(c) },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
