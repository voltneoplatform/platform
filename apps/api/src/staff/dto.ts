import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, type Role } from '@voltneo/shared';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === ''
    ? null
    : typeof value === 'string'
      ? value.trim()
      : value;

export class CreateStaffDto {
  @ApiProperty({ example: 'Rina Das' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiPropertyOptional({ example: 'rina@voltneo.in' })
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ example: '9830012345', description: 'Indian mobile number' })
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: Role;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DEACTIVATED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DEACTIVATED'])
  status?: 'ACTIVE' | 'DEACTIVATED';
}

export class ListStaffQuery {
  @IsOptional() @IsIn(ROLES) role?: Role;
  @IsOptional() @IsIn(['ACTIVE', 'DEACTIVATED']) status?: 'ACTIVE' | 'DEACTIVATED';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}
