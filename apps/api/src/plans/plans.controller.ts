import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { hasPermission } from '@voltneo/shared';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { PlanNamesDto, PublishVersionDto, UpdatePlanDto, UpdateVersionDto } from './dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@ApiBearerAuth()
@Controller()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** Field agents see plans and prices, but never costs or cost floors. */
  @Get('plans')
  @RequirePermissions('plans.read')
  list(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.plans.list(hasPermission(staff.role, 'costs.read'));
  }

  @Get('plans/:id')
  @RequirePermissions('plans.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.plans.get(id, hasPermission(staff.role, 'costs.read'));
  }

  @Post('plans')
  @RequirePermissions('plans.manage')
  create(
    @Body() dto: PlanNamesDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.create(dto, staff, meta);
  }

  @Patch('plans/:id')
  @RequirePermissions('plans.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.update(id, dto, staff, meta);
  }

  @Post('plans/:id/versions')
  @RequirePermissions('plans.manage')
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.newVersion(id, staff, meta);
  }

  @Patch('plan-versions/:id')
  @RequirePermissions('plans.manage')
  updateVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVersionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.updateVersion(id, dto, staff, meta);
  }

  /** Previews the cost-floor check against today's costs. */
  @Get('plan-versions/:id/check')
  @RequirePermissions('plans.manage', 'costs.read')
  check(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.check(id);
  }

  @Post('plan-versions/:id/publish')
  @HttpCode(200)
  @RequirePermissions('plans.manage', 'approvals.request')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishVersionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.publish(id, dto, staff, meta);
  }

  @Post('plan-versions/:id/discard')
  @HttpCode(200)
  @RequirePermissions('plans.manage')
  discard(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.plans.discardVersion(id, staff, meta);
  }
}
