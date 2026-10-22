import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthSession } from '@voltneo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  CurrentStaff,
  Public,
  ReqMeta,
  type AuthenticatedStaff,
  type RequestMeta,
  type RequestWithContext,
} from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, permissionsFor, toStaffProfile, type IssuedSession } from './auth.service';
import { OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto';

export const REFRESH_COOKIE = 'vn_refresh';

/**
 * Web clients (the admin panel) send `X-Client: web`. They receive the refresh
 * token as an httpOnly cookie that page scripts cannot read. App clients
 * (Field App, Driver App) receive it in the response body and keep it in
 * secure device storage.
 */
function isWebClient(req: RequestWithContext): boolean {
  return (req.get('x-client') ?? '').toLowerCase() === 'web';
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(@Body() dto: OtpRequestDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.requestOtp(dto.identifier, meta);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'X-Client', required: false, description: '"web" for the admin panel' })
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AuthSession> {
    const web = isWebClient(req);
    const session = await this.auth.verifyOtp(dto.identifier, dto.code, web ? 'WEB' : 'APP', meta);
    return this.deliver(session, web, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AuthSession> {
    const web = isWebClient(req);
    const cookies = (req as RequestWithContext & { cookies?: Record<string, string> }).cookies;
    const token = web ? cookies?.[REFRESH_COOKIE] : dto.refreshToken;
    try {
      const session = await this.auth.refresh(token, meta);
      return this.deliver(session, web, res);
    } catch (err) {
      if (web) this.clearCookie(res);
      throw err;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @ReqMeta() meta: RequestMeta,
  ): Promise<void> {
    await this.auth.logout(staff.sessionId, staff.id, meta);
    if (isWebClient(req)) this.clearCookie(res);
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentStaff() staff: AuthenticatedStaff) {
    const row = await this.prisma.staffUser.findUniqueOrThrow({ where: { id: staff.id } });
    return { staff: toStaffProfile(row), permissions: permissionsFor(row.role) };
  }

  private deliver(session: IssuedSession, web: boolean, res: Response): AuthSession {
    if (!web) return session;
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/v1/auth',
      expires: new Date(session.refreshTokenExpiresAt),
    });
    const { refreshToken: _omit, refreshTokenExpiresAt: _omit2, ...rest } = session;
    return rest;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }
}
