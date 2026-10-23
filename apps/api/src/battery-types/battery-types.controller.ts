import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { hasPermission } from '@voltneo/shared';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { BatteryTypesService } from './battery-types.service';
import { CostBasisDto, CreateBatteryTypeDto, UpdateBatteryTypeDto } from './dto';

@ApiTags('Battery types')
@ApiBearerAuth()
@Controller('battery-types')
export class BatteryTypesController {
  constructor(private readonly types: BatteryTypesService) {}

  /** Costs are included only for roles allowed to see them. */
  @Get()
  @RequirePermissions('battery_types.read')
  list(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.types.list(hasPermission(staff.role, 'costs.read'));
  }

  @Get(':id')
  @RequirePermissions('battery_types.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.types.get(id, hasPermission(staff.role, 'costs.read'));
  }

  @Post()
  @RequirePermissions('battery_types.manage')
  create(
    @Body() dto: CreateBatteryTypeDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.types.create(dto, staff, meta);
  }

  @Patch(':id')
  @RequirePermissions('battery_types.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBatteryTypeDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.types.update(id, dto, staff, meta);
  }

  /** Records a new purchase cost and cost-floor allowances; history is kept. */
  @Post(':id/costs')
  @RequirePermissions('battery_types.manage')
  addCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CostBasisDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.types.addCost(id, dto, staff, meta);
  }
}
