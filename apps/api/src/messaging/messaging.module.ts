import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DLT_REGISTRATION } from './dlt-registration';
import {
  LogMessageSender,
  MESSAGE_SENDER,
  MemoryMessageSender,
  SmsGatewayHubMessageSender,
} from './message-sender';
import { SmsGatewayHubClient } from './smsgatewayhub';
import { EMAIL_SENDER, LogEmailSender, MemoryEmailSender, SesEmailSender } from './email-sender';
import { MessagingService } from './messaging.service';

@Global()
@Module({
  providers: [
    MessagingService,
    {
      provide: MESSAGE_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.messageDelivery === 'memory') return new MemoryMessageSender();
        if (config.smsGatewayHub) {
          return new SmsGatewayHubMessageSender(
            new SmsGatewayHubClient(config.smsGatewayHub, DLT_REGISTRATION),
          );
        }
        return new LogMessageSender();
      },
    },
    {
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.messageDelivery === 'memory') return new MemoryEmailSender();
        if (config.ses) return new SesEmailSender(config.ses, config.deployment === 'staging');
        return new LogEmailSender();
      },
    },
  ],
  exports: [MessagingService, MESSAGE_SENDER, EMAIL_SENDER],
})
export class MessagingModule {}
