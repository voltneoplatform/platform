import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentStaff,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { sendPdf } from '../agreements/agreements.controller';
import { CertificateQuery, FinishEarlyDto, TransferDto } from './dto';
import { OwnershipService } from './ownership.service';

@ApiTags('Finishing early and ownership transfer')
@ApiBearerAuth()
@Controller('agreements/:id')
export class OwnershipController {
  constructor(private readonly ownership: OwnershipService) {}

  /** Early-exit quote (if the battery is installed) and transfer status. */
  @Get('ownership')
  @RequirePermissions('agreements.read')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.ownership.view(id);
  }

  /** Spec section 6 name for the quote alone. */
  @Get('early-exit-quote')
  @RequirePermissions('agreements.read')
  async quote(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.ownership.view(id)).earlyExit;
  }

  /** Records payment of exactly the quoted balance (clause E7). */
  @Post('early-exit')
  @RequireAnyPermission('payments.record', 'payments.collect_cash')
  finishEarly(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FinishEarlyDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ownership.finishEarly(id, dto, staff, meta);
  }

  /** GPS switched off in the supplier portal: ownership passes, certificate issued. */
  @Post('transfer')
  @HttpCode(200)
  @RequirePermissions('transfers.record')
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ownership.transfer(id, dto, staff, meta);
  }

  @Get('certificate')
  @RequirePermissions('agreements.read')
  @ApiProduces('application/pdf')
  async certificate(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: CertificateQuery,
    @Res() res: Response,
  ) {
    const { pdf, fileName } = await this.ownership.certificate(id, q.lang);
    sendPdf(res, pdf, fileName);
  }
}
