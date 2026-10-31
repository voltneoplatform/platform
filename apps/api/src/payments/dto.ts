import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DRIVER_LANGUAGES,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHODS,
  type DriverLanguage,
  type ManualPaymentMethod,
  type PaymentMethod,
} from '@voltneo/shared';
import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { emptyToNull, trim } from '../battery-types/dto';

const MAX_PAYMENT_PAISE = 1_00_00_000_00; // ₹1 crore: far above any agreement

export class RecordPaymentDto {
  @ApiProperty() @IsUUID() agreementId: string;

  @ApiProperty({ description: 'Amount in paise' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAYMENT_PAISE)
  amountPaise: number;

  @ApiProperty({ enum: MANUAL_PAYMENT_METHODS })
  @IsIn(MANUAL_PAYMENT_METHODS)
  method: ManualPaymentMethod;

  @ApiPropertyOptional({ description: 'UPI transaction ID (UTR) or card approval code' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @Matches(/^[A-Za-z0-9/-]{4,64}$/, { message: 'Reference: 4-64 letters, digits, / or -' })
  reference?: string | null;

  @ApiPropertyOptional({ description: 'Defaults to now' })
  @IsOptional()
  @IsDateString({ strict: true })
  receivedAt?: string;

  @ApiPropertyOptional({ description: 'Cash only: the agent holding the cash; defaults to you' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  collectedById?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) note?: string | null;

  @ApiPropertyOptional({
    description: 'Unique ID from the device, so a repeated request is not counted twice',
  })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @Length(8, 100)
  clientRequestId?: string | null;
}

export class ListPaymentsQuery {
  @IsOptional() @IsUUID() agreementId?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @IsOptional() @IsUUID() collectedById?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ReceiptQuery {
  @IsOptional() @IsIn(DRIVER_LANGUAGES) lang?: DriverLanguage;
}

export class CashDepositDto {
  @ApiPropertyOptional({ description: 'Agent whose cash this is; defaults to you' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  agentId?: string | null;

  @ApiProperty({ description: 'Amount in paise' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAYMENT_PAISE)
  amountPaise: number;

  @ApiProperty({ description: 'Bank deposit slip or transfer reference' })
  @Transform(trim)
  @IsString()
  @Length(3, 64)
  bankReference: string;

  @ApiProperty() @IsDateString({ strict: true }) depositedAt: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) note?: string | null;
}

export class ListDepositsQuery {
  @IsOptional() @IsIn(['PENDING', 'RECONCILED']) status?: 'PENDING' | 'RECONCILED';
  @IsOptional() @IsUUID() agentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ReconcileDto {
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) note?: string | null;
}
