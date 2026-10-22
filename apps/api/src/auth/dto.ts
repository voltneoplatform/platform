import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class OtpRequestDto {
  @ApiProperty({ description: 'Email address or Indian mobile number', example: 'ops@voltneo.in' })
  @IsString()
  @MaxLength(254)
  identifier: string;
}

export class OtpVerifyDto {
  @ApiProperty({ example: '9830012345' })
  @IsString()
  @MaxLength(254)
  identifier: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description: 'App clients send this. Web clients use the httpOnly cookie.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}
