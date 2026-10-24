import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COLLECTION_STAGES, type CollectionStage } from '@voltneo/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

export class QueueQuery {
  @IsOptional() @IsIn(COLLECTION_STAGES) stage?: CollectionStage;
}

export class RunJobsDto {
  @ApiPropertyOptional({ description: 'Business date to run for; outside production only' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class RequestActionDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}

export class ImmobilisationDto {
  @ApiProperty({ enum: ['DISABLE', 'RESTORE'] }) @IsIn(['DISABLE', 'RESTORE']) action:
    'DISABLE' | 'RESTORE';

  @ApiProperty({ description: 'When it was done in the GPS supplier portal' })
  @IsDateString({ strict: true })
  performedAt: string;

  @ApiProperty({ description: 'Reference or screenshot ID from the GPS supplier portal' })
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  portalReference: string;

  @ApiPropertyOptional({
    description: 'Required for a disable: the portal showed the vehicle stationary',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  vehicleStationaryConfirmed?: boolean;

  @ApiPropertyOptional({ description: 'Who acted in the portal; defaults to you' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  performedById?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) note?: string | null;
}

/** Multipart form fields sent with optional recovery photos. */
export class RecoveryDto {
  @ApiProperty({ description: 'The battery collected (must be the agreement battery)' })
  @IsUUID()
  batteryId: string;

  @ApiProperty({ description: 'Staff member who collected it' }) @IsUUID() recoveredById: string;
  @ApiProperty() @IsDateString({ strict: true }) recoveredAt: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) location: string;

  @ApiProperty({ description: 'Condition of the battery and GPS module when collected' })
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  conditionNote: string;
}
