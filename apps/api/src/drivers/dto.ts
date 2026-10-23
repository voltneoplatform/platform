import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DRIVER_LANGUAGES,
  KYC_DOC_TYPES,
  VEHICLE_TYPES,
  type DriverLanguage,
  type KycDocType,
  type VehicleType,
} from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1'
    ? true
    : value === false || value === 'false' || value === '0'
      ? false
      : value;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PIN = /^[1-9]\d{5}$/;

export class VehicleDto {
  @ApiPropertyOptional({ example: 'WB 02 AB 1234' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(20)
  registration?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(30)
  chassisNumber?: string | null;

  @ApiProperty({ enum: VEHICLE_TYPES }) @IsIn(VEHICLE_TYPES) type: VehicleType;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(60) makeModel?: string | null;

  @ApiProperty({ description: 'False for renter-drivers (D21)' })
  @Transform(toBool)
  @IsBoolean()
  ownedByDriver: boolean;

  @IsOptional() @Transform(emptyToNull) @IsString() @Length(2, 100) ownerName?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) ownerPhone?: string | null;

  @ApiPropertyOptional({
    description: 'Proceed even though this vehicle is recorded for another driver',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  acknowledgeDuplicates?: boolean;
}

class DriverFields {
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 100) name: string;
  @ApiProperty({ example: '9830012345' }) @Transform(trim) @IsString() @MaxLength(20) phone: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) altPhone?: string | null;
  @ApiProperty({ enum: DRIVER_LANGUAGES }) @IsIn(DRIVER_LANGUAGES) language: DriverLanguage;

  @ApiPropertyOptional({ example: '1988-04-12' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(DATE, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth?: string | null;

  @ApiProperty() @Transform(trim) @IsString() @Length(3, 200) addressLine: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) area?: string | null;
  @ApiProperty({ example: 'South 24 Parganas' })
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  district: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60) state?: string;
  @ApiProperty({ example: '700001' })
  @Transform(trim)
  @Matches(PIN, { message: 'pinCode must be 6 digits' })
  pinCode: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @Length(2, 100) nomineeName?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @Length(2, 40) nomineeRelation?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) nomineePhone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
}

export class CreateDriverDto extends DriverFields {
  @ApiPropertyOptional({ type: VehicleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VehicleDto)
  vehicle?: VehicleDto;

  @ApiPropertyOptional({
    description: 'Proceed even though the phone number belongs to another driver',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  acknowledgeDuplicates?: boolean;
}

export class UpdateDriverDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 100) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) altPhone?: string | null;
  @IsOptional() @IsIn(DRIVER_LANGUAGES) language?: DriverLanguage;
  @IsOptional() @Transform(emptyToNull) @Matches(DATE) dateOfBirth?: string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(3, 200) addressLine?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100) area?: string | null;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60) district?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 60) state?: string;
  @IsOptional() @Transform(trim) @Matches(PIN) pinCode?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @Length(2, 100) nomineeName?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @Length(2, 40) nomineeRelation?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(20) nomineePhone?: string | null;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @Transform(toBool) @IsBoolean() acknowledgeDuplicates?: boolean;
}

export class ListDriversQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsIn(['ready', 'not_ready']) readiness?: 'ready' | 'not_ready';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Sent as multipart form fields alongside the file. */
export class UploadKycDto {
  @ApiProperty({ enum: KYC_DOC_TYPES }) @IsIn(KYC_DOC_TYPES) type: KycDocType;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(40) number?: string | null;

  @ApiPropertyOptional({ description: 'This document is the proof of address' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  usedForAddress?: boolean;

  @IsOptional() @Transform(toBool) @IsBoolean() acknowledgeDuplicates?: boolean;
}

export class RejectKycDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 300) reason: string;
}
