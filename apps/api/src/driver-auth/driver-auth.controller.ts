import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentDriver,
  DriverRoute,
  Public,
  ReqMeta,
  type AuthenticatedDriver,
  type RequestMeta,
} from '../common/decorators';
import { DriverAuthService } from './driver-auth.service';
import {
  DriverCodeRequestDto,
  DriverCodeVerifyDto,
  DriverRefreshDto,
  DriverSelectDto,
} from './dto';

/** Driver App sign-in (M6). */
@ApiTags('Driver App: sign-in')
@Controller('driver-auth')
export class DriverAuthController {
  constructor(private readonly auth: DriverAuthService) {}

  @Public()
  @Post('code/request')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  request(@Body() dto: DriverCodeRequestDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.requestCode(dto.phone, meta);
  }

  @Public()
  @Post('code/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() dto: DriverCodeVerifyDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verify(dto.phone, dto.code, meta);
  }

  @Public()
  @Post('select')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  select(@Body() dto: DriverSelectDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.select(dto.selectToken, dto.driverId, meta);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: DriverRefreshDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @ApiBearerAuth()
  @DriverRoute()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentDriver() driver: AuthenticatedDriver, @ReqMeta() meta: RequestMeta) {
    await this.auth.logout(driver.sessionId, driver.id, meta);
  }
}
