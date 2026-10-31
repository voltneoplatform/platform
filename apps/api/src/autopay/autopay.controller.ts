import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  CurrentStaff,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { AutopayService } from './autopay.service';

class CancelAutopayDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
class RunAutopayDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
class SimulateMandateDto {
  @IsIn(['ACTIVE', 'CUSTOMER_CANCELLED', 'LINK_EXPIRED']) status: string;
}
class SimulateChargeDto {
  @IsIn(['SUCCESS', 'FAILED']) status: 'SUCCESS' | 'FAILED';
}

/** UPI AutoPay for head office (M6): view, switch off, run the daily step. */
@ApiTags('UPI AutoPay')
@ApiBearerAuth()
@Controller()
export class AutopayController {
  constructor(
    private readonly autopay: AutopayService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('agreements/:id/autopay')
  @RequirePermissions('agreements.read')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.autopay.view(id);
  }

  @Post('agreements/:id/autopay/cancel')
  @HttpCode(200)
  @RequireAnyPermission('payments.record', 'collections.assign')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAutopayDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.autopay.cancel(id, { type: 'STAFF', id: staff.id }, meta, dto.reason);
  }

  /** Runs the daily AutoPay step now (it also runs at 10:00 India time). */
  @Post('autopay/run')
  @HttpCode(200)
  @RequirePermissions('collections.assign')
  run(@Body() dto: RunAutopayDto) {
    if (dto.date && this.config.nodeEnv === 'production') {
      throw new ForbiddenException('A date can only be given outside production');
    }
    return this.autopay.runDaily(dto.date);
  }

  /** Development only: pretend the driver approved or cancelled the mandate. */
  @Post('autopay/mandates/:id/simulate')
  @HttpCode(200)
  @RequireAnyPermission('payments.record', 'collections.assign')
  simulateMandate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateMandateDto) {
    return this.autopay.simulateMandate(id, dto.status);
  }

  /** Development only: pretend the gateway took or failed to take a charge. */
  @Post('autopay/charges/:id/simulate')
  @HttpCode(200)
  @RequireAnyPermission('payments.record', 'collections.assign')
  simulateCharge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateChargeDto) {
    return this.autopay.simulateCharge(id, dto.status);
  }
}
