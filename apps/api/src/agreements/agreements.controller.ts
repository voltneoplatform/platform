import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../files/file-storage';
import { SCHEDULE_DOCS, type ScheduleDoc } from '../documents/documents.service';
import type { UploadedFile as File } from '../drivers/drivers.service';
import {
  CancelAgreementDto,
  CreateAgreementDto,
  DocumentQuery,
  InstallationDto,
  ListAgreementsQuery,
  RescheduleDto,
  SignAgreementDto,
  UpdateAgreementDto,
} from './dto';
import { AgreementsService } from './agreements.service';

export function sendPdf(res: Response, pdf: Buffer, fileName: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/[^\w.-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

@ApiTags('Agreements and installation')
@ApiBearerAuth()
@Controller()
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get('agreements')
  @RequirePermissions('agreements.read')
  list(@Query() q: ListAgreementsQuery) {
    return this.agreements.list(q);
  }

  @Get('agreements/options')
  @RequirePermissions('agreements.manage')
  options() {
    return this.agreements.options();
  }

  @Get('agreements/:id')
  @RequirePermissions('agreements.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.agreements.get(id);
  }

  @Get('agreements/:id/schedule')
  @RequirePermissions('agreements.read')
  async schedule(@Param('id', ParseUUIDPipe) id: string) {
    const a = await this.agreements.get(id);
    return { number: a.number, terms: a.terms, money: a.money, lines: a.schedule };
  }

  @Post('agreements')
  @RequirePermissions('agreements.manage')
  create(
    @Body() dto: CreateAgreementDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.create(dto, staff, meta);
  }

  @Patch('agreements/:id')
  @RequirePermissions('agreements.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgreementDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.update(id, dto, staff, meta);
  }

  @Post('agreements/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('agreements.manage')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAgreementDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.cancel(id, dto, staff, meta);
  }

  @Post('agreements/:id/sign')
  @HttpCode(200)
  @RequirePermissions('agreements.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }),
  )
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignAgreementDto,
    @UploadedFile() file: File | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.sign(id, dto, file, staff, meta);
  }

  @Post('agreements/:id/signed-copy/link')
  @HttpCode(200)
  @RequirePermissions('agreements.read')
  signedCopy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.signedCopyLink(id, staff, meta);
  }

  @Post('agreements/:id/reschedule')
  @RequirePermissions('agreements.manage', 'approvals.request')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.requestReschedule(id, dto, staff, meta);
  }

  @Get('agreements/:id/documents/:schedule')
  @RequirePermissions('agreements.read')
  @ApiProduces('application/pdf')
  async document(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('schedule') schedule: string,
    @Query() q: DocumentQuery,
    @Res() res: Response,
  ) {
    if (!(SCHEDULE_DOCS as readonly string[]).includes(schedule)) {
      throw new NotFoundException('Available documents: schedule-1 and schedule-5');
    }
    const { pdf, fileName } = await this.agreements.document(id, schedule as ScheduleDoc, q.lang);
    sendPdf(res, pdf, fileName);
  }

  @Post('agreements/:id/installation')
  @HttpCode(200)
  @RequirePermissions('installations.record')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('photos', 6, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 6, fields: 20 } }),
  )
  install(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InstallationDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.recordInstallation(id, dto, files, staff, meta);
  }

  @Post('agreements/:id/installation/photos/:photoId/link')
  @HttpCode(200)
  @RequirePermissions('agreements.read')
  photo(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.agreements.installationPhotoLink(id, photoId);
  }
}
