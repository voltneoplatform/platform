import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DLT_REGISTRATION } from '../messaging/dlt-registration';
import { SmsGatewayHubClient } from '../messaging/smsgatewayhub';
import { DriverAuthController } from './driver-auth.controller';
import { DRIVER_AUDIENCE, DriverAuthService } from './driver-auth.service';
import {
  DRIVER_CODE_SENDER,
  LogDriverCodeSender,
  MemoryDriverCodeSender,
  RoutingDriverCodeSender,
  SmsDriverCodeSender,
  TestEmailDriverCodeSender,
} from './driver-code-sender';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', issuer: 'voltneo-api', audience: DRIVER_AUDIENCE },
        verifyOptions: { algorithms: ['HS256'], issuer: 'voltneo-api', audience: DRIVER_AUDIENCE },
      }),
    }),
  ],
  controllers: [DriverAuthController],
  providers: [
    DriverAuthService,
    {
      provide: DRIVER_CODE_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.otpDelivery === 'memory') return new MemoryDriverCodeSender();
        const minutes = Math.round(config.otpTtlSeconds / 60);
        const client = config.smsGatewayHub
          ? new SmsGatewayHubClient(config.smsGatewayHub, DLT_REGISTRATION)
          : null;
        const sms = client ? new SmsDriverCodeSender(client, minutes) : null;
        const fallback =
          config.nodeEnv !== 'production'
            ? new LogDriverCodeSender()
            : config.driverCodeTestEmail && config.ses
              ? new TestEmailDriverCodeSender(config.ses, config.driverCodeTestEmail)
              : null;
        return new RoutingDriverCodeSender(sms, fallback);
      },
    },
  ],
  exports: [DriverAuthService, DRIVER_CODE_SENDER],
})
export class DriverAuthModule {}
