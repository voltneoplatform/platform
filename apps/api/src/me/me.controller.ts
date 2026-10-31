import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  CurrentDriver,
  DriverRoute,
  ReqMeta,
  type AuthenticatedDriver,
  type RequestMeta,
} from '../common/decorators';
import { sendPdf } from '../agreements/agreements.controller';
import { AgreementQuery, ReportFaultDto, SetLanguageDto } from './dto';
import { MeService } from './me.service';

/** Driver App routes (M6): every route needs a driver's sign-in. */
@ApiTags('Driver App')
@ApiBearerAuth()
@DriverRoute()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  profile(@CurrentDriver() d: AuthenticatedDriver) {
    return this.me.profile(d);
  }

  @Patch()
  language(
    @CurrentDriver() d: AuthenticatedDriver,
    @Body() dto: SetLanguageDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.setLanguage(d, dto.language, meta);
  }

  @Get('agreement')
  agreement(@CurrentDriver() d: AuthenticatedDriver, @Query() q: AgreementQuery) {
    return this.me.agreement(d, q.id);
  }

  @Post('agreements/:id/pay')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pay(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.pay(d, id, meta);
  }

  /** Starts UPI AutoPay: returns the approval page to open. */
  @Post('agreements/:id/autopay')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  startAutopay(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.startAutopay(d, id, meta);
  }

  @Post('agreements/:id/autopay/cancel')
  @HttpCode(200)
  stopAutopay(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.stopAutopay(d, id, meta);
  }

  @Get('agreements/:id/signed-copy')
  signedCopy(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.signedCopy(d, id, meta);
  }

  @Get('agreements/:id/key-facts')
  @ApiProduces('application/pdf')
  async keyFacts(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { pdf, fileName } = await this.me.document(d, id, 'schedule-5');
    sendPdf(res, pdf, fileName);
  }

  @Get('agreements/:id/schedule')
  @ApiProduces('application/pdf')
  async schedule(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { pdf, fileName } = await this.me.document(d, id, 'schedule-1');
    sendPdf(res, pdf, fileName);
  }

  @Get('payments')
  payments(@CurrentDriver() d: AuthenticatedDriver) {
    return this.me.payments(d);
  }

  @Get('payments/:id/receipt')
  @ApiProduces('application/pdf')
  async receipt(
    @CurrentDriver() d: AuthenticatedDriver,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { pdf, fileName } = await this.me.receipt(d, id);
    sendPdf(res, pdf, fileName);
  }

  @Get('tickets')
  tickets(@CurrentDriver() d: AuthenticatedDriver) {
    return this.me.ticketList(d);
  }

  @Post('tickets')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  report(
    @CurrentDriver() d: AuthenticatedDriver,
    @Body() dto: ReportFaultDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.me.reportFault(d, dto, meta);
  }
}
