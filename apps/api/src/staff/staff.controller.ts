import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { CreateStaffDto, ListStaffQuery, UpdateStaffDto } from './dto';
import { StaffService } from './staff.service';

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  list(@Query() q: ListStaffQuery) {
    return this.staff.list(q);
  }

  @Get(':id')
  @RequirePermissions('staff.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.get(id);
  }

  @Post()
  @RequirePermissions('staff.manage')
  create(
    @Body() dto: CreateStaffDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.staff.create(dto, actor, meta);
  }

  @Patch(':id')
  @RequirePermissions('staff.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.staff.update(id, dto, actor, meta);
  }
}
