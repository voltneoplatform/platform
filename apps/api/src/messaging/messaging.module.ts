import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { LogMessageSender, MESSAGE_SENDER, MemoryMessageSender } from './message-sender';
import { MessagingService } from './messaging.service';

@Global()
@Module({
  providers: [
    MessagingService,
    {
      provide: MESSAGE_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.messageDelivery === 'memory' ? new MemoryMessageSender() : new LogMessageSender(),
    },
  ],
  exports: [MessagingService, MESSAGE_SENDER],
})
export class MessagingModule {}
