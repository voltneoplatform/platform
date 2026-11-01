import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TICKET_CATEGORIES,
  TICKET_CHANNELS,
  TICKET_OUTCOMES,
  TICKET_STATUSES,
  TICKET_TIMINGS,
  type TicketCategory,
  type TicketChannel,
  type TicketOutcome,
  type TicketStatus,
  type TicketTiming,
} from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

export class CreateTicketDto {
  @ApiProperty() @IsUUID() agreementId: string;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: TicketCategory;
  @ApiProperty({ enum: TICKET_CHANNELS }) @IsIn(TICKET_CHANNELS) channel: TicketChannel;

  @ApiProperty({ description: "The driver's words: what happens and since when" })
  @Transform(trim)
  @IsString()
  @Length(5, 1000)
  description: string;

  @ApiPropertyOptional({
    description: 'When the driver reported it (defaults to now); the 48 hours run from here',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  reportedAt?: string;

  @ApiPropertyOptional({ description: 'Assign a technician straight away' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  technicianId?: string | null;
}

export class ListTicketsQuery {
  @IsOptional() @IsIn(TICKET_STATUSES) status?: TicketStatus;
  /** OPEN and ASSIGNED together. */
  @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
  @IsOptional() @IsIn(TICKET_TIMINGS) timing?: TicketTiming;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsUUID() agreementId?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class AssignTicketDto {
  @ApiProperty() @IsUUID() technicianId: string;
}

export class VisitDto {
  @ApiProperty() @IsDateString({ strict: true }) visitedAt: string;

  @ApiPropertyOptional({ description: 'Defaults to the assigned technician' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  technicianId?: string | null;

  @ApiPropertyOptional({ description: 'Battery voltage measured, in volts' })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null || value === undefined ? null : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  voltageReading?: number | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) readingsNote?: string | null;

  @ApiProperty({ description: 'What the technician found or did' })
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  finding: string;
}

export class ReplaceBatteryDto {
  @ApiProperty({ description: 'In-stock battery of the same type, with a GPS module' })
  @IsUUID()
  newBatteryId: string;

  @ApiProperty() @IsDateString({ strict: true }) replacedAt: string;

  @ApiPropertyOptional({ description: 'Defaults to the assigned technician' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  technicianId?: string | null;

  @ApiProperty({ description: 'Voltage of the new battery after fitting, in volts' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  voltageReading: number;

  @ApiProperty({ description: 'Fault and condition of the battery taken out' })
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  oldBatteryNote: string;
}

export class ResolveTicketDto {
  @ApiProperty({ enum: TICKET_OUTCOMES }) @IsIn(TICKET_OUTCOMES) outcome: TicketOutcome;

  @ApiProperty({ description: 'What was done, in a sentence or two' })
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  resolution: string;
}

export class RejectCloseDto {
  @ApiProperty({ description: 'Why the ticket is not closed yet (the field user sees this)' })
  @Transform(trim)
  @IsString()
  @Length(5, 300)
  reason: string;
}

export class CancelTicketDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 500) reason: string;
}
