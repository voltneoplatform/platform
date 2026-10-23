import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { APPROVAL_TYPES, type ApprovalType } from '@voltneo/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { ApprovalsService } from './approvals.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ListApprovalsQuery {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?:
    'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  @IsOptional() @IsIn(APPROVAL_TYPES) type?: ApprovalType;
}

class ApproveDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

class RejectDto {
  @Transform(trim) @IsString() @Length(3, 500) note: string;
}

@ApiTags('Approvals')
@ApiBearerAuth()
@Controller('approval-requests')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequirePermissions('approvals.request')
  list(@Query() q: ListApprovalsQuery, @CurrentStaff() viewer: AuthenticatedStaff) {
    return this.approvals.list(viewer, q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('approvals.decide')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.approvals.approve(id, staff, dto.note, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('approvals.decide')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.approvals.reject(id, staff, dto.note, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('approvals.request')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.approvals.cancel(id, staff, meta);
  }
}
