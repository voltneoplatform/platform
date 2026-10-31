import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class DriverCodeRequestDto {
  @ApiProperty({ description: 'Registered mobile number', example: '9830012345' })
  @IsString()
  @MaxLength(20)
  phone: string;
}

export class DriverCodeVerifyDto extends DriverCodeRequestDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class DriverSelectDto {
  @ApiProperty() @IsString() @MaxLength(2000) selectToken: string;
  @ApiProperty() @IsUUID() driverId: string;
}

export class DriverRefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken: string;
}
