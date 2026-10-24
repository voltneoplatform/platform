import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CurrentStaff,
  Public,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { sendPdf } from '../agreements/agreements.controller';
import {
  CashDepositDto,
  ListDepositsQuery,
  ListPaymentsQuery,
  ReceiptQuery,
  ReconcileDto,
  RecordPaymentDto,
} from './dto';
import { PaymentsService } from './payments.service';
import { CashService } from './cash.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly cash: CashService,
  ) {}

  @Post('payments')
  @RequireAnyPermission('payments.record', 'payments.collect_cash')
  record(
    @Body() dto: RecordPaymentDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.payments.record(dto, staff, meta);
  }

  @Get('payments')
  @RequirePermissions('payments.read')
  list(@Query() q: ListPaymentsQuery) {
    return this.payments.list(q);
  }

  @Get('payments/:id')
  @RequirePermissions('payments.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(id);
  }

  @Get('agreements/:id/payments')
  @RequirePermissions('payments.read')
  forAgreement(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListPaymentsQuery) {
    return this.payments.list({ ...q, agreementId: id });
  }

  @Get('payments/:id/receipt')
  @RequirePermissions('payments.read')
  @ApiProduces('application/pdf')
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ReceiptQuery,
    @Res() res: Response,
  ) {
    const { pdf, fileName } = await this.payments.receipt(id, q.lang);
    sendPdf(res, pdf, fileName);
  }

  @Post('payments/:id/resend-receipt')
  @HttpCode(200)
  @RequireAnyPermission('messages.send', 'payments.record')
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.payments.resendReceipt(id, staff, meta);
  }

  // Cash ---------------------------------------------------------------------

  @Get('cash/holdings')
  @RequirePermissions('cash_deposits.reconcile')
  holdings() {
    return this.cash.holdings();
  }

  @Get('cash/deposits')
  @RequireAnyPermission('cash_deposits.reconcile', 'payments.collect_cash')
  deposits(@Query() q: ListDepositsQuery, @CurrentStaff() staff: AuthenticatedStaff) {
    // Agents see only their own deposits.
    const own = staff.role === 'FIELD_AGENT' ? { agentId: staff.id } : {};
    return this.cash.list({ ...q, ...own });
  }

  @Post('cash/deposits')
  @RequireAnyPermission('payments.collect_cash', 'cash_deposits.reconcile')
  deposit(
    @Body() dto: CashDepositDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.cash.deposit(dto, staff, meta);
  }

  @Post('cash/deposits/:id/reconcile')
  @HttpCode(200)
  @RequirePermissions('cash_deposits.reconcile')
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.cash.reconcile(id, dto, staff, meta);
  }

  @Get('ledger/balances')
  @RequirePermissions('cash_deposits.reconcile')
  ledger() {
    return this.cash.ledgerBalances();
  }
}

/** Payment provider callbacks: no login, but every request must carry a valid signature. */
@ApiTags('Payments')
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':provider')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.receive(provider, req.rawBody, req.headers);
  }
}
