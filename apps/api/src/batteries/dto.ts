import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BATTERY_STATUSES, type BatteryStatus } from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const SERIAL = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,59}$/;
const MAX_PAISE = 100_000_000_00;

class BatteryCommon {
  @ApiProperty()
  @IsUUID()
  batteryTypeId: string;

  @ApiProperty({ example: '2026-10-20' })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'purchaseDate must be YYYY-MM-DD' })
  purchaseDate: string;

  @ApiPropertyOptional({
    description: "Paise. Defaults to the battery type's current purchase cost.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  purchaseCost?: number;

  @ApiPropertyOptional({ example: 'Head office store, Kolkata' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ description: 'Supplier invoice or batch reference' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  supplierRef?: string | null;
}

export class CreateBatteryDto extends BatteryCommon {
  @ApiProperty({ example: 'NEO51-000123' })
  @Transform(trim)
  @Matches(SERIAL, { message: 'serial must be 3-60 letters, digits, spaces or . _ / -' })
  serial: string;

  @ApiPropertyOptional({ example: 'GPS-8812345' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(SERIAL, { message: 'gpsDeviceId must be 3-60 letters, digits, spaces or . _ / -' })
  gpsDeviceId?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
}

export class BulkItemDto {
  @Transform(trim) @IsString() serial: string;
  @IsOptional() @Transform(emptyToNull) @IsString() gpsDeviceId?: string | null;
}

export class BulkCreateBatteriesDto extends BatteryCommon {
  @ApiProperty({ type: [BulkItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkItemDto)
  items: BulkItemDto[];
}

export class UpdateBatteryDto {
  @IsOptional() @Transform(trim) @Matches(SERIAL) serial?: string;
  @IsOptional() @Transform(emptyToNull) @Matches(SERIAL) gpsDeviceId?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) location?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) supplierRef?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
}

export class MoveBatteryDto {
  @ApiProperty({ enum: ['IN_STOCK', 'UNDER_REPAIR'] })
  @IsIn(['IN_STOCK', 'UNDER_REPAIR'])
  to: 'IN_STOCK' | 'UNDER_REPAIR';

  @ApiPropertyOptional({ description: 'Where the battery now is (stock or workshop)' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(100)
  location?: string | null;

  @ApiPropertyOptional({ description: 'Technician now holding the battery, if any' })
  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) note?: string | null;
}

export class RetireBatteryDto {
  @ApiProperty({ description: 'Why the battery should be retired' })
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason: string;
}

export class ListBatteriesQuery {
  @IsOptional() @IsUUID() batteryTypeId?: string;
  @IsOptional() @IsIn(BATTERY_STATUSES) status?: BatteryStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
