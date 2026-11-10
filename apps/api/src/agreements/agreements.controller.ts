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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { INSTALLATION_ITEMS, maxInstallationPhotos } from '@voltneo/shared';
import { ApiBearerAuth, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentStaff,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../files/file-storage';
import { AGREEMENT_DOC, SCHEDULE_DOCS, type ScheduleDoc } from '../documents/documents.service';
import type { UploadedFile as File } from '../drivers/drivers.service';
import {
  CancelAgreementDto,
  ChangeBatteryDto,
  CreateAgreementDto,
  DocumentQuery,
  CheckInstallationPhotoDto,
  InstallationDto,
  InstallationItemDto,
  ListAgreementsQuery,
  RejectInstallationDto,
  RescheduleDto,
  ResignAgreementDto,
  SignAgreementDto,
  UpdateAgreementDto,
} from './dto';
import { AgreementsService, type InstallationPhotoFiles } from './agreements.service';
import { MAX_SIGNED_PDF_BYTES, MAX_SIGNED_PHOTOS } from './signed-copy';

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
    // One scanned PDF, or photos of every page (joined into one PDF).
    FilesInterceptor('files', MAX_SIGNED_PHOTOS, {
      limits: { fileSize: MAX_SIGNED_PDF_BYTES, files: MAX_SIGNED_PHOTOS, fields: 12 },
    }),
  )
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignAgreementDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.sign(id, dto, files, staff, meta);
  }

  /** Founder, 1 Nov 2026: the assigned battery can change until it is installed. */
  @Post('agreements/:id/battery')
  @HttpCode(200)
  @RequirePermissions('agreements.manage')
  changeBattery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeBatteryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.changeBattery(id, dto, staff, meta);
  }

  /** The corrected agreement the driver signed after a battery change. */
  @Post('agreements/:id/resign')
  @HttpCode(200)
  @RequirePermissions('agreements.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_SIGNED_PHOTOS, {
      limits: { fileSize: MAX_SIGNED_PDF_BYTES, files: MAX_SIGNED_PHOTOS, fields: 4 },
    }),
  )
  resign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResignAgreementDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.recordResigning(id, dto, files, staff, meta);
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
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    if (schedule === AGREEMENT_DOC) {
      const { pdf, fileName } = await this.agreements.agreementDocument(id, staff, meta);
      return sendPdf(res, pdf, fileName);
    }
    if (!(SCHEDULE_DOCS as readonly string[]).includes(schedule)) {
      throw new NotFoundException('Available documents: agreement, schedule-1 and schedule-5');
    }
    const { pdf, fileName } = await this.agreements.document(id, schedule as ScheduleDoc, q.lang);
    sendPdf(res, pdf, fileName);
  }

  /**
   * Photos come in one multipart field per item: BATTERY, GPS, VEHICLE,
   * VOLTAGE, HANDOVER (required) and OTHER (founder, 10 Nov 2026).
   */
  @Post('agreements/:id/installation')
  @HttpCode(200)
  @RequirePermissions('installations.record')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor(
      INSTALLATION_ITEMS.map((name) => ({ name, maxCount: maxInstallationPhotos(name) })),
      { limits: { fileSize: MAX_UPLOAD_BYTES, files: 20, fields: 20 } },
    ),
  )
  install(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InstallationDto,
    @UploadedFiles() files: InstallationPhotoFiles | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.recordInstallation(id, dto, files ?? {}, staff, meta);
  }

  /** Installations waiting for photo checks or the final approval (founder, 10 Nov 2026). */
  @Get('installations/pending')
  @RequireAnyPermission('installations.verify', 'installations.approve')
  pendingInstallations() {
    return this.agreements.pendingInstallations();
  }

  /** A new photo of one item, in place of a rejected or missing one. */
  @Post('agreements/:id/installation/:installationId/photos')
  @HttpCode(200)
  @RequirePermissions('installations.record')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('photos', 4, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 4, fields: 5 } }),
  )
  addInstallationPhotos(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() dto: InstallationItemDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.addInstallationPhotos(id, installationId, dto.item, files, staff, meta);
  }

  @Post('agreements/:id/installation/photos/:photoId/verify')
  @HttpCode(200)
  @RequirePermissions('installations.verify')
  verifyInstallationPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.checkInstallationPhoto(id, photoId, 'VERIFIED', null, staff, meta);
  }

  @Post('agreements/:id/installation/photos/:photoId/reject')
  @HttpCode(200)
  @RequirePermissions('installations.verify')
  rejectInstallationPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() dto: CheckInstallationPhotoDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.checkInstallationPhoto(id, photoId, 'REJECTED', dto.reason, staff, meta);
  }

  /** Final approval once every photo is checked: the agreement starts. */
  @Post('agreements/:id/installation/:installationId/approve')
  @HttpCode(200)
  @RequirePermissions('installations.approve')
  approveInstallation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.approveInstallation(id, installationId, staff, meta);
  }

  /** Sends the whole installation back to be recorded again. */
  @Post('agreements/:id/installation/:installationId/reject')
  @HttpCode(200)
  @RequirePermissions('installations.approve')
  rejectInstallation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installationId', ParseUUIDPipe) installationId: string,
    @Body() dto: RejectInstallationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.agreements.rejectInstallation(id, installationId, dto.reason, staff, meta);
  }

  @Post('agreements/:id/installation/photos/:photoId/link')
  @HttpCode(200)
  @RequirePermissions('agreements.read')
  photo(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.agreements.installationPhotoLink(id, photoId);
  }
}
