import { ApiProperty } from '@nestjs/swagger';
import {
  DRIVER_LANGUAGES,
  TICKET_CATEGORIES,
  type DriverLanguage,
  type TicketCategory,
} from '@voltneo/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { trim } from '../battery-types/dto';

export class SetLanguageDto {
  @ApiProperty({ enum: DRIVER_LANGUAGES }) @IsIn(DRIVER_LANGUAGES) language: DriverLanguage;
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
