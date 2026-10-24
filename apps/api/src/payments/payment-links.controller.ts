import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import {
  CurrentStaff,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { PaymentLinksService } from './payment-links.service';

class CreateLinkDto {
  @ApiProperty({ description: 'Amount in paise' })
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1_00_00_000_00)
  amountPaise: number;
}

/** UPI payment links sent to the driver by SMS (M5, Cashfree). */
@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @Get('agreements/:id/payment-links')
  @RequirePermissions('agreements.read')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.list(id);
  }

  @Post('agreements/:id/payment-links')
  @RequireAnyPermission('payments.record', 'payments.collect_cash')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLinkDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.links.create(id, dto.amountPaise, staff, meta);
  }

  @Post('payment-links/:id/resend')
  @HttpCode(200)
  @RequireAnyPermission('payments.record', 'payments.collect_cash')
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.links.resend(id, staff, meta);
  }

  @Post('payment-links/:id/cancel')
  @HttpCode(200)
  @RequireAnyPermission('payments.record', 'payments.collect_cash')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.links.cancel(id, staff, meta);
  }

  /** Development only: pretend the driver paid a fake link. */
  @Post('payment-links/:id/simulate-paid')
  @HttpCode(200)
  @RequirePermissions('payments.record')
  simulate(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.simulatePaid(id);
  }
}
