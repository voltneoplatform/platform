import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_TERM_MONTHS } from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const MAX_PAISE = 100_000_000_00;

export class PlanNamesDto {
  @ApiProperty({ example: 'সহজ শুরু' }) @Transform(trim) @IsString() @MaxLength(100) nameBn: string;
  @ApiProperty({ example: 'आसान शुरुआत' })
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nameHi: string;
  @ApiProperty({ example: 'Easy Start' })
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  nameEn: string;
}

export class UpdatePlanDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) nameBn?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) nameHi?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) nameEn?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'RETIRED'],
    description: 'Retired plans take no new sign-ups',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'RETIRED'])
  status?: 'ACTIVE' | 'RETIRED';
}

export class PriceRowDto {
  @ApiProperty() @IsUUID() batteryTypeId: string;

  @ApiProperty({ description: 'Paise' })
  @IsInt()
  @Min(0)
  @Max(MAX_PAISE)
  downPayment: number;

  @ApiProperty({ description: 'Paise' })
  @IsInt()
  @Min(1)
  @Max(MAX_PAISE)
  instalment: number;
}

export class UpdateVersionDto {
  @ApiPropertyOptional({ description: 'Number of monthly instalments' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TERM_MONTHS)
  termMonths?: number;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;

  @ApiPropertyOptional({ type: [PriceRowDto], description: 'Replaces the whole price grid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PriceRowDto)
  prices?: PriceRowDto[];
}

export class PublishVersionDto {
  @ApiPropertyOptional({
    description:
      'Required only when a price is below its cost floor: the reason for asking a second person to approve an exception',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  exceptionReason?: string;
}
