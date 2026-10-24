import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DRIVER_LANGUAGES, type DriverLanguage } from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';
import { RecordPaymentDto } from '../payments/dto';

/**
 * Finishing early is a payment of exactly the quoted balance (clause E7). The
 * quoted amount is sent back so a balance that changed in the meantime (a late
 * fee added at midnight, another payment) is caught instead of paid short.
 */
export class FinishEarlyDto extends RecordPaymentDto {
  @ApiProperty({ description: 'The total from the early-exit quote, in paise' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotedTotalPaise: number;
}

export class TransferDto {
  @ApiProperty({ description: 'When the GPS module was switched off in the supplier portal' })
  @IsDateString({ strict: true })
  gpsOffAt: string;

  @ApiProperty({ description: 'Reference or screenshot ID from the GPS supplier portal' })
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  gpsPortalReference: string;

  @ApiProperty({ description: 'Staff member who switched it off in the portal' })
  @IsUUID()
  gpsOffById: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) note?: string | null;
}

export class CertificateQuery {
  @ApiPropertyOptional({ enum: DRIVER_LANGUAGES })
  @IsOptional()
  @IsIn(DRIVER_LANGUAGES)
  lang?: DriverLanguage;
}
