import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LogOtpSender, MemoryOtpSender, OTP_SENDER, SesOtpSender } from './otp-sender';

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
        if (config.otpDelivery === 'ses' && config.ses) {
          return new SesOtpSender(
            config.ses,
            Math.round(config.otpTtlSeconds / 60),
            config.deployment === 'staging',
          );
        }
        return new LogOtpSender();
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, OTP_SENDER],
})
export class AuthModule {}
