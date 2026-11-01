import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  CurrentStaff,
  ReqMeta,
  RequirePermissions,
  type AuthenticatedStaff,
  type RequestMeta,
} from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../files/file-storage';
import {
  ApproveDriverDto,
  ConfirmPhoneCodeDto,
  CreateDriverDto,
  ListDriversQuery,
  RejectDriverDto,
  RejectKycDto,
  SendPhoneCodeDto,
  VerifyPhoneDto,
  UpdateDriverDto,
  UploadKycDto,
  VehicleDto,
} from './dto';
import { DriversService, type UploadedFile as File } from './drivers.service';
import { PhoneChecksService } from './phone-checks.service';

const upload = () =>
  UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }),
  );

@ApiTags('Drivers and KYC')
@ApiBearerAuth()
@Controller()
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly phoneChecks: PhoneChecksService,
  ) {}

  /** Sends a registration code to the driver's phone (founder, 1 Nov 2026). */
  @Post('drivers/phone-codes')
  @RequirePermissions('drivers.manage')
  sendPhoneCode(@Body() dto: SendPhoneCodeDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.phoneChecks.send(dto, staff);
  }

  @Post('drivers/phone-codes/confirm')
  @HttpCode(200)
  @RequirePermissions('drivers.manage')
  confirmPhoneCode(@Body() dto: ConfirmPhoneCodeDto, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.phoneChecks.confirm(dto.checkId, dto.code, staff);
  }

  @Post('drivers/:id/verify-phone')
  @HttpCode(200)
  @RequirePermissions('drivers.manage')
  verifyPhone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyPhoneDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.verifyPhone(id, dto.phoneCheckId, staff, meta);
  }

  @Post('drivers/:id/approve')
  @HttpCode(200)
  @RequirePermissions('drivers.approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDriverDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.approve(id, dto, staff, meta);
  }

  @Post('drivers/:id/reject')
  @HttpCode(200)
  @RequirePermissions('drivers.approve')
  rejectDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDriverDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.reject(id, dto, staff, meta);
  }

  @Post('drivers/:id/resubmit')
  @HttpCode(200)
  @RequirePermissions('drivers.manage')
  resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.resubmit(id, staff, meta);
  }

  @Get('drivers')
  @RequirePermissions('drivers.read')
  list(@Query() q: ListDriversQuery) {
    return this.drivers.list(q);
  }

  @Get('drivers/:id')
  @RequirePermissions('drivers.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.drivers.get(id);
  }

  @Post('drivers')
  @RequirePermissions('drivers.manage')
  create(
    @Body() dto: CreateDriverDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.create(dto, staff, meta);
  }

  @Patch('drivers/:id')
  @RequirePermissions('drivers.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.update(id, dto, staff, meta);
  }

  @Put('drivers/:id/vehicle')
  @RequirePermissions('drivers.manage')
  setVehicle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VehicleDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.setVehicle(id, dto, staff, meta);
  }

  @Post('drivers/:id/vehicle/owner-consent')
  @RequirePermissions('drivers.manage')
  @ApiConsumes('multipart/form-data')
  @upload()
  ownerConsent(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: File | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.uploadOwnerConsent(id, file, staff, meta);
  }

  @Post('drivers/:id/vehicle/owner-consent/link')
  @HttpCode(200)
  @RequirePermissions('kyc.view_full')
  ownerConsentLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.ownerConsentLink(id, staff, meta);
  }

  @Post('drivers/:id/kyc')
  @RequirePermissions('drivers.manage')
  @ApiConsumes('multipart/form-data')
  @upload()
  uploadKyc(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadKycDto,
    @UploadedFile() file: File | undefined,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.uploadKyc(id, dto, file, staff, meta);
  }

  @Post('kyc-documents/:id/verify')
  @HttpCode(200)
  @RequirePermissions('kyc.verify')
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.verifyKyc(id, staff, meta);
  }

  @Post('kyc-documents/:id/reject')
  @HttpCode(200)
  @RequirePermissions('kyc.verify')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectKycDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.rejectKyc(id, dto, staff, meta);
  }

  /** POST, not GET, so the request is never cached or prefetched. */
  @Post('kyc-documents/:id/link')
  @HttpCode(200)
  @RequirePermissions('kyc.view_full')
  link(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.kycLink(id, staff, meta);
  }

  @Post('kyc-documents/:id/reveal')
  @HttpCode(200)
  @RequirePermissions('kyc.view_full')
  reveal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.drivers.revealNumber(id, staff, meta);
  }
}
