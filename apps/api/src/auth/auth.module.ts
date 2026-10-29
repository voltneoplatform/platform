import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DLT_REGISTRATION } from '../messaging/dlt-registration';
import { SmsGatewayHubClient } from '../messaging/smsgatewayhub';
import {
  LogOtpSender,
  MemoryOtpSender,
  OTP_SENDER,
  RoutingOtpSender,
  SesOtpSender,
  SmsOtpSender,
} from './otp-sender';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', issuer: 'voltneo-api', audience: 'voltneo-staff' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'voltneo-api', audience: 'voltneo-staff' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: OTP_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.otpDelivery === 'memory') return new MemoryOtpSender();
        if (config.otpDelivery !== 'ses' || !config.ses) return new LogOtpSender();
        const minutes = Math.round(config.otpTtlSeconds / 60);
        const email = new SesOtpSender(config.ses, minutes, config.deployment === 'staging');
        // SMS codes only once the DLT sign-in template is approved and filled in.
        const client = config.smsGatewayHub
          ? new SmsGatewayHubClient(config.smsGatewayHub, DLT_REGISTRATION)
          : null;
        const sms = client?.ready('sign_in_code', 'EN') ? new SmsOtpSender(client, minutes) : null;
        return new RoutingOtpSender(email, sms);
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, OTP_SENDER],
})
export class AuthModule {}
