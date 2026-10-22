import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LogOtpSender, MemoryOtpSender, OTP_SENDER } from './otp-sender';

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
      useFactory: (config: AppConfig) =>
        config.otpDelivery === 'memory' ? new MemoryOtpSender() : new LogOtpSender(),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, OTP_SENDER],
})
export class AuthModule {}
