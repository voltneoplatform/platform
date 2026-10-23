import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VEHICLE_TYPES, type VehicleType } from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

const MAX_PAISE = 100_000_000_00; // ₹10 crore: far above any battery cost

/** All amounts are in paise (whole numbers). */
export class CostBasisDto {
  @ApiProperty({ description: 'Purchase cost per battery, in paise', example: 5_500_000 })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  purchaseCost: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PAISE) gpsCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PAISE) serviceCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PAISE) financingCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PAISE) collectionCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_PAISE) expectedLossCost?: number;

  @ApiPropertyOptional({ description: 'Why the cost changed, e.g. new supplier quote' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

class BatteryTypeFields {
  @ApiProperty({ example: 'Neo 51' })
  @Transform(trim)
  @IsString()
  @Length(2, 40)
  name: string;

  @ApiProperty({ example: 51.2 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(1000)
  voltage: number;

  @ApiProperty({ example: 105 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(10000)
  capacityAh: number;

  @ApiProperty({ example: 'LFP (lithium iron phosphate)' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  chemistry: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  supplier: string;

  @ApiProperty({ description: "Supplier's warranty in months" })
  @IsInt()
  @Min(0)
  @Max(240)
  warrantyMonths: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(500)
  warrantyNotes?: string | null;

  @ApiProperty({ enum: VEHICLE_TYPES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(VEHICLE_TYPES, { each: true })
  compatibleVehicles: VehicleType[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CreateBatteryTypeDto extends BatteryTypeFields {
  @ApiProperty({ type: CostBasisDto })
  @ValidateNested()
  @Type(() => CostBasisDto)
  cost: CostBasisDto;
}

export class UpdateBatteryTypeDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 40) name?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(1) @Max(1000) voltage?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(1) @Max(10000) capacityAh?: number;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60) chemistry?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100) supplier?: string;
  @IsOptional() @IsInt() @Min(0) @Max(240) warrantyMonths?: number;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) warrantyNotes?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(VEHICLE_TYPES, { each: true })
  compatibleVehicles?: VehicleType[];
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}
