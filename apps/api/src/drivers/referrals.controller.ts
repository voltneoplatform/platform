import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { ReferralSearchQuery, ReferrerDto, UpdateReferrerDto } from './dto';
import { ReferralsService } from './referrals.service';

/** Referrals (founder, 7 Nov 2026): outside referrers, kept by head office. */
@ApiTags('referrals')
@ApiBearerAuth()
@Controller()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** Every referrer with counts (most referrals first). */
  @Get('referrals')
  @RequirePermissions('drivers.read')
  board(@Query() q: ReferralSearchQuery) {
    return this.referrals.board(q);
  }

  /** Active referrers matching a name, mobile or ID, to pick while registering. */
  @Get('referrals/search')
  @RequirePermissions('drivers.read')
  search(@Query() q: ReferralSearchQuery) {
    return this.referrals.search(q);
  }

  @Get('referrers/:id')
  @RequirePermissions('drivers.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.referrals.getReferrer(id);
  }

  @Post('referrers')
  @RequirePermissions('referrals.manage')
  create(
    @Body() dto: ReferrerDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.referrals.createReferrer(dto, staff, meta);
  }

  @Patch('referrers/:id')
  @RequirePermissions('referrals.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReferrerDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.referrals.updateReferrer(id, dto, staff, meta);
  }
}
