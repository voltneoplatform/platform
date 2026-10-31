import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AutopayController } from './autopay.controller';
import { AutopayPageController } from './autopay-page.controller';
import { AutopayService } from './autopay.service';

@Module({
  imports: [PaymentsModule],
  controllers: [AutopayController, AutopayPageController],
  providers: [AutopayService],
  exports: [AutopayService],
})
export class AutopayModule {}
