import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Express } from 'express';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { requestIdMiddleware } from './common/request-id.middleware';

/** Shared by main.ts and the end-to-end tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: [config.adminOrigin, ...config.extraOrigins], credentials: true });
  // Short payment links (/p/<code>) stay outside /v1 so the SMS address is short.
  app.setGlobalPrefix('v1', { exclude: [{ path: 'p/:code', method: RequestMethod.GET }] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  if (config.nodeEnv !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Volt Neo API')
        .setDescription('Platform API for the Volt Neo admin panel, Field App and Driver App')
        .setVersion('0.3.0 (M2)')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }
}
