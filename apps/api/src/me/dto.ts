import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DRIVER_LANGUAGES,
  TICKET_CATEGORIES,
  type DriverLanguage,
  type TicketCategory,
} from '@voltneo/shared';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { trim } from '../battery-types/dto';

/** The driver's own details they can change in the app: language and email. */
export class UpdateMeDto {
  @ApiPropertyOptional({ enum: DRIVER_LANGUAGES })
  @IsOptional()
  @IsIn(DRIVER_LANGUAGES)
  language?: DriverLanguage;

  @ApiPropertyOptional({ description: 'Empty removes it' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (value.trim() ? value.trim().toLowerCase() : null) : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email?: string | null;
}

export class StartAutopayDto {
  @ApiPropertyOptional({ enum: ['UPI', 'ENACH'], default: 'UPI' })
  @IsOptional()
  @IsIn(['UPI', 'ENACH'])
  method?: 'UPI' | 'ENACH';
}

export class AgreementQuery {
  @IsOptional() @IsUUID() id?: string;
}

export class ReportFaultDto {
  @ApiProperty() @IsUUID() agreementId: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: TicketCategory;

  @ApiProperty({ description: 'What happens, in the driver’s words' })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  description: string;
}
