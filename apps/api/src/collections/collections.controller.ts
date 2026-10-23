import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
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
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { MAX_UPLOAD_BYTES } from '../files/file-storage';
import type { UploadedFile as File } from '../drivers/drivers.service';
import { CollectionsService } from './collections.service';
import { ImmobilisationDto, QueueQuery, RecoveryDto, RequestActionDto, RunJobsDto } from './dto';

@ApiTags('Collections')
@ApiBearerAuth()
@Controller()
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('collections/queue')
  @RequirePermissions('collections.read')
  queue(@Query() q: QueueQuery) {
    return this.collections.queue(q);
  }

  /** Runs the daily check and today's notices now (they also run on schedule). */
  @Post('collections/run')
  @HttpCode(200)
  @RequirePermissions('collections.assign')
  async run(@Body() dto: RunJobsDto) {
    if (dto.date && this.config.nodeEnv === 'production') {
      throw new ForbiddenException('A date can only be given outside production');
    }
    const daily = await this.collections.runDaily(dto.date);
    const notices = await this.collections.runNotices(dto.date);
    return { daily, notices };
  }

  @Get('agreements/:id/collections')
  @RequirePermissions('collections.read')
  forAgreement(@Param('id', ParseUUIDPipe) id: string) {
    return this.collections.forAgreement(id);
  }

  @Post('agreements/:id/immobilisation-request')
  @RequirePermissions('collections.assign', 'approvals.request')
  requestImmobilisation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestActionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.collections.requestImmobilisation(id, dto, staff, meta);
  }

  /** Records a disable or restore done in the GPS supplier's portal. */
  @Post('agreements/:id/immobilisation')
  @HttpCode(200)
  @RequirePermissions('collections.assign')
  immobilisation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImmobilisationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.collections.recordImmobilisation(id, dto, staff, meta);
  }

  @Post('agreements/:id/recovery-request')
  @RequirePermissions('collections.assign', 'approvals.request')
  requestRecovery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestActionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.collections.requestRecovery(id, dto, staff, meta);
  }

  @Post('agreements/:id/recovery')
  @HttpCode(200)
  @RequirePermissions('recovery.record')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('photos', 6, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 6, fields: 20 } }),
  )
  recovery(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoveryDto,
    @UploadedFiles() files: File[] | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.collections.recordRecovery(id, dto, files, staff, meta);
  }

  @Post('agreements/:id/recovery/photos/:photoId/link')
  @HttpCode(200)
  @RequirePermissions('collections.read')
  photo(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.collections.recoveryPhotoLink(id, photoId);
  }
}
