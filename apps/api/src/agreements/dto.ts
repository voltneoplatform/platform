import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AGREEMENT_STATES,
  DRIVER_LANGUAGES,
  DUE_DAYS,
  type AgreementState,
  type DriverLanguage,
  type DueDay,
} from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1' ? true : value;

export class CreateAgreementDto {
  @ApiProperty() @IsUUID() driverId: string;
  @ApiProperty() @IsUUID() planVersionId: string;
  @ApiProperty() @IsUUID() batteryTypeId: string;

  @ApiProperty({ enum: DUE_DAYS, description: 'Monthly due day: the 2nd or the 17th (D37)' })
  @Type(() => Number)
  @IsIn(DUE_DAYS)
  dueDay: DueDay;

  @ApiProperty({ example: '2026-11-17' }) @Matches(DATE) firstDueDate: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateAgreementDto {
  @IsOptional() @IsUUID() planVersionId?: string;
  @IsOptional() @IsUUID() batteryTypeId?: string;
  @IsOptional() @Type(() => Number) @IsIn(DUE_DAYS) dueDay?: DueDay;
  @IsOptional() @Matches(DATE) firstDueDate?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;
}

export class ListAgreementsQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsIn(AGREEMENT_STATES) state?: AgreementState;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Multipart form fields sent with the scan of the signed paper agreement. */
export class SignAgreementDto {
  @ApiProperty({ description: 'When the driver signed (not in the future)' })
  @IsDateString({ strict: true })
  signedAt: string;

  @ApiProperty({ enum: DRIVER_LANGUAGES, description: 'Language the agreement was explained in' })
  @IsIn(DRIVER_LANGUAGES)
  explainedInLanguage: DriverLanguage;

  @ApiPropertyOptional({ description: 'Staff member who explained it; defaults to you' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  explainedById?: string | null;

  @ApiProperty({ description: 'Stamp paper serial number, or e-stamp certificate number' })
  @Transform(trim)
  @IsString()
  @Length(3, 60)
  stampPaperNumber: string;

  @ApiProperty({ description: 'Value of the stamp paper, in whole rupees' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_00_000)
  stampValueRupees: number;

  @ApiProperty({ example: '2026-10-30', description: 'Date the stamp paper was bought' })
  @Matches(DATE)
  stampPurchasedOn: string;
}

export class CancelAgreementDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class RescheduleDto {
  @ApiProperty({ example: '2026-12-17' }) @Matches(DATE) firstDueDate: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class DocumentQuery {
  @IsOptional() @IsIn(DRIVER_LANGUAGES) lang?: DriverLanguage;
}

/** Multipart form fields sent with the installation photos (Schedule 3). */
export class InstallationDto {
  @ApiProperty() @IsUUID() batteryId: string;
  @ApiProperty({ description: 'Technician who installed it' }) @IsUUID() technicianId: string;
  @ApiProperty() @IsDateString({ strict: true }) installedAt: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) location: string;

  @ApiProperty({ description: 'Battery voltage measured after installation (V)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  voltageReading: number;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) readingsNote?: string | null;

  @ApiProperty({ description: 'Condition of the battery and vehicle wiring' })
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  conditionNote: string;

  @ApiProperty({ description: 'The driver confirms the installation record' })
  @Transform(toBool)
  @Equals(true, { message: 'The driver must confirm the installation record' })
  driverConfirmed: true;
}
