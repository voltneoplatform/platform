import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { hasPermission } from '@voltneo/shared';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { BatteriesService } from './batteries.service';
import {
  BulkCreateBatteriesDto,
  CreateBatteryDto,
  ListBatteriesQuery,
  MoveBatteryDto,
  RetireBatteryDto,
  UpdateBatteryDto,
} from './dto';

@ApiTags('Batteries')
@ApiBearerAuth()
@Controller('batteries')
export class BatteriesController {
  constructor(private readonly batteries: BatteriesService) {}

  @Get()
  @RequirePermissions('batteries.read')
  list(@Query() q: ListBatteriesQuery, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.batteries.list(q, hasPermission(staff.role, 'costs.read'));
  }

  @Get(':id')
  @RequirePermissions('batteries.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.batteries.get(id, hasPermission(staff.role, 'costs.read'));
  }

  @Get(':id/custody')
  @RequirePermissions('batteries.read')
  custody(@Param('id', ParseUUIDPipe) id: string) {
    return this.batteries.custody(id);
  }

  @Post()
  @RequirePermissions('batteries.manage')
  create(
    @Body() dto: CreateBatteryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.batteries.create(dto, staff, meta);
  }

  @Post('bulk')
  @RequirePermissions('batteries.manage')
  bulk(
    @Body() dto: BulkCreateBatteriesDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.batteries.bulkCreate(dto, staff, meta);
  }

  @Patch(':id')
  @RequirePermissions('batteries.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBatteryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.batteries.update(id, dto, staff, meta);
  }

  @Post(':id/status')
  @RequirePermissions('batteries.manage')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveBatteryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.batteries.move(id, dto, staff, meta);
  }

  /** Puts the battery forward for retirement; a second person must approve. */
  @Post(':id/retire')
  @RequirePermissions('batteries.manage', 'approvals.request')
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetireBatteryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.batteries.requestRetirement(id, dto, staff, meta);
  }
}
