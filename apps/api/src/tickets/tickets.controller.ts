import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../files/file-storage';
import type { UploadedFile as File } from '../drivers/drivers.service';
import {
  AssignTicketDto,
  CancelTicketDto,
  RejectCloseDto,
  CreateTicketDto,
  ListTicketsQuery,
  ReplaceBatteryDto,
  ResolveTicketDto,
  VisitDto,
} from './dto';
import { TicketsService } from './tickets.service';

const photos = () =>
  UseInterceptors(
    FilesInterceptor('photos', 6, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 6, fields: 20 } }),
  );

@ApiTags('Service tickets')
@ApiBearerAuth()
@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('tickets')
  @RequirePermissions('tickets.read')
  list(@Query() q: ListTicketsQuery) {
    return this.tickets.list(q);
  }

  @Post('tickets')
  @RequirePermissions('tickets.manage')
  create(
    @Body() dto: CreateTicketDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.create(dto, staff, meta);
  }

  @Get('tickets/:id')
  @RequirePermissions('tickets.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.tickets.get(id, staff);
  }

  /** Assign or reassign the technician (spec: PATCH /tickets/:id). */
  @Patch('tickets/:id')
  @RequirePermissions('tickets.manage')
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.assign(id, dto, staff, meta);
  }

  @Post('tickets/:id/visits')
  @RequirePermissions('tickets.resolve')
  @ApiConsumes('multipart/form-data')
  @photos()
  visit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VisitDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.recordVisit(id, dto, files, staff, meta);
  }

  @Post('tickets/:id/replacement')
  @RequirePermissions('tickets.resolve')
  @ApiConsumes('multipart/form-data')
  @photos()
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceBatteryDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.replaceBattery(id, dto, files, staff, meta);
  }

  @Post('tickets/:id/resolve')
  @HttpCode(200)
  @RequireAnyPermission('tickets.resolve', 'tickets.close')
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveTicketDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.resolve(id, dto, staff, meta);
  }

  @Post('tickets/:id/close/approve')
  @HttpCode(200)
  @RequirePermissions('tickets.close')
  approveClose(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.approveClose(id, staff, meta);
  }

  @Post('tickets/:id/close/reject')
  @HttpCode(200)
  @RequirePermissions('tickets.close')
  rejectClose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectCloseDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.rejectClose(id, dto.reason, staff, meta);
  }

  @Post('tickets/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('tickets.manage')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTicketDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tickets.cancel(id, dto, staff, meta);
  }

  @Post('tickets/:id/photos/:photoId/link')
  @HttpCode(200)
  @RequirePermissions('tickets.read')
  photo(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.tickets.photoLink(id, photoId);
  }

  /** Every service visit on one battery, with readings. */
  @Get('batteries/:id/service-history')
  @RequirePermissions('batteries.read')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.batteryHistory(id);
  }
}
