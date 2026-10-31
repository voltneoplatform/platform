import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { PaymentsModule } from '../payments/payments.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutopayModule } from '../autopay/autopay.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AgreementsModule, PaymentsModule, TicketsModule, AutopayModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
