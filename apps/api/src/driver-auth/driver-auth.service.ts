import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { DRIVER_LANGUAGES, normaliseIndianMobile, type DriverLanguage } from '@voltneo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Driver } from '../generated/prisma/client';
import type { RequestMeta } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import type { Tx } from '../common/util';
import {
  generateOtpCode,
  generateRefreshToken,
  hashOtp,
  hashRefreshToken,
  safeEqualHex,
} from '../auth/crypto';
import { DRIVER_CODE_SENDER, type DriverCodeSender } from './driver-code-sender';

/** Driver tokens are signed for a different audience, so the staff guard never accepts them. */
export const DRIVER_AUDIENCE = 'voltneo-driver';

export interface DriverAccessClaims {
  sub: string;
  sid: string;
  typ: 'driver';
}

interface SelectClaims {
  phone: string;
  ids: string[];
  typ: 'driver_select';
}

export interface DriverSessionView {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  driver: { id: string; name: string; language: DriverLanguage };
}

export type VerifyResult =
  | { session: DriverSessionView }
  /** A shared phone: the driver picks their name, then calls /select with this token. */
  | { choose: { id: string; name: string }[]; selectToken: string };

const BAD_CODE = 'The code is wrong or has expired. Ask for a new code.';
const SESSION_ENDED = 'Please sign in again.';
const DAY = 86_400_000;
/** Agreement states in which a driver can use the app (anything signed and not cancelled). */
const NOT_SIGNED = ['DRAFT', 'CANCELLED'] as const;

/**
 * Driver App sign-in (M6): a 6-digit code to the driver's registered mobile
 * number, then rotating refresh tokens. Only drivers with a signed agreement
 * can sign in. Replies never say whether a number is registered.
 */
@Injectable()
export class DriverAuthService {
  private readonly logger = new Logger(DriverAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DRIVER_CODE_SENDER) private readonly sender: DriverCodeSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private phoneOf(raw: string): string {
    const phone = normaliseIndianMobile(raw);
    if (!phone) throw new BadRequestException('Enter a 10-digit Indian mobile number');
    return phone;
  }

  /** Drivers on this phone who may use the app. */
  private drivers(phone: string): Promise<Driver[]> {
    return this.prisma.driver.findMany({
      where: {
        phone,
        status: 'ACTIVE',
        agreements: { some: { state: { notIn: [...NOT_SIGNED] } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async requestCode(rawPhone: string, meta: RequestMeta) {
    const phone = this.phoneOf(rawPhone);
    const answer = { sent: true as const, expiresInSeconds: this.config.otpTtlSeconds };
    // Decided before looking the number up, so the reply says nothing about the account.
    if (!DRIVER_LANGUAGES.some((l) => this.sender.canSend(l))) {
      throw new HttpException(
        'Sign-in codes cannot be sent yet. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const drivers = await this.drivers(phone);
    if (!drivers.length) return answer;

    const latest = await this.prisma.driverOtpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    const cooldownMs = this.config.otpResendCooldownSeconds * 1000;
    if (latest && this.clock.now().getTime() - latest.createdAt.getTime() < cooldownMs) {
      return answer;
    }

    const code = generateOtpCode();
    const id = randomUUID();
    await this.prisma.$transaction([
      this.prisma.driverOtpChallenge.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: this.clock.now() },
      }),
      this.prisma.driverOtpChallenge.create({
        data: {
          id,
          phone,
          codeHash: hashOtp(this.config.otpHashSecret, id, code),
          expiresAt: new Date(this.clock.now().getTime() + this.config.otpTtlSeconds * 1000),
          requestIp: meta.ip,
          createdAt: this.clock.now(),
        },
      }),
    ]);

    const preferred = drivers[0]!.language as DriverLanguage;
    const language = this.sender.canSend(preferred)
      ? preferred
      : (DRIVER_LANGUAGES.find((l) => this.sender.canSend(l)) ?? 'EN');
    try {
      await this.sender.send({ phone, code, language, names: drivers.map((d) => d.name) });
    } catch (err) {
      this.logger.error(`Driver code delivery failed for ${phone}`, err as Error);
      throw new HttpException(
        'Could not send the code. Try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return answer;
  }

  async verify(rawPhone: string, code: string, meta: RequestMeta): Promise<VerifyResult> {
    const phone = this.phoneOf(rawPhone);
    const now = this.clock.now();
    const challenge = await this.prisma.driverOtpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new UnauthorizedException(BAD_CODE);
    const counted = await this.prisma.driverOtpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: this.config.otpMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      await this.prisma.driverOtpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      throw new UnauthorizedException(BAD_CODE);
    }
    const ok = safeEqualHex(
      challenge.codeHash,
      hashOtp(this.config.otpHashSecret, challenge.id, code),
    );
    if (!ok) throw new UnauthorizedException(BAD_CODE);
    const consumed = await this.prisma.driverOtpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) throw new UnauthorizedException(BAD_CODE);

    const drivers = await this.drivers(phone);
    if (!drivers.length) throw new UnauthorizedException(BAD_CODE);
    if (drivers.length === 1) return { session: await this.start(drivers[0]!, meta) };
    const claims: SelectClaims = { phone, ids: drivers.map((d) => d.id), typ: 'driver_select' };
    const selectToken = await this.jwt.signAsync(claims, {
      audience: DRIVER_AUDIENCE,
      expiresIn: 300,
    });
    return { choose: drivers.map((d) => ({ id: d.id, name: d.name })), selectToken };
  }

  async select(token: string, driverId: string, meta: RequestMeta): Promise<DriverSessionView> {
    let claims: SelectClaims;
    try {
      claims = await this.jwt.verifyAsync<SelectClaims>(token, { audience: DRIVER_AUDIENCE });
    } catch {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    if (claims.typ !== 'driver_select' || !claims.ids.includes(driverId)) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    const driver = (await this.drivers(claims.phone)).find((d) => d.id === driverId);
    if (!driver) throw new UnauthorizedException(SESSION_ENDED);
    return this.start(driver, meta);
  }

  private async start(driver: Driver, meta: RequestMeta): Promise<DriverSessionView> {
    return this.prisma.$transaction(async (tx) => {
      const issued = await this.issue(tx, driver, meta, randomUUID(), null);
      await this.audit.record(
        {
          actorType: 'DRIVER',
          actorId: driver.id,
          action: 'driver_auth.login',
          tableName: 'driver_sessions',
          recordId: issued.sessionId,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return issued.view;
    });
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<DriverSessionView> {
    if (!refreshToken) throw new UnauthorizedException(SESSION_ENDED);
    const session = await this.prisma.driverSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { driver: true },
    });
    if (!session || session.revokedAt) throw new UnauthorizedException(SESSION_ENDED);
    const now = this.clock.now();
    if (session.rotatedAt) {
      // An old refresh token came back: it may have been copied. End the whole family.
      await this.prisma.driverSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'refresh_token_reused' },
      });
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'driver_auth.refresh_token_reused',
        tableName: 'driver_sessions',
        recordId: session.id,
        after: { driverId: session.driverId, familyId: session.familyId },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new UnauthorizedException(SESSION_ENDED);
    }
    // Each refresh makes a new row, so the row's age is the time since last use.
    const idle =
      now.getTime() - session.createdAt.getTime() > this.config.driverSessionIdleDays * DAY;
    const expired = now.getTime() >= session.expiresAt.getTime();
    const inactive = session.driver.status !== 'ACTIVE';
    if (idle || expired || inactive) {
      await this.prisma.driverSession.update({
        where: { id: session.id },
        data: {
          revokedAt: now,
          revokedReason: inactive ? 'driver_inactive' : idle ? 'idle_timeout' : 'expired',
        },
      });
      throw new UnauthorizedException(SESSION_ENDED);
    }
    return this.prisma.$transaction(async (tx) => {
      const rotated = await tx.driverSession.updateMany({
        where: { id: session.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (rotated.count === 0) throw new UnauthorizedException(SESSION_ENDED);
      return (await this.issue(tx, session.driver, meta, session.familyId, session.expiresAt)).view;
    });
  }

  async logout(sessionId: string, driverId: string, meta: RequestMeta): Promise<void> {
    const session = await this.prisma.driverSession.findUnique({ where: { id: sessionId } });
    if (!session || session.driverId !== driverId) return;
    await this.prisma.driverSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: 'logout' },
    });
    await this.audit.record({
      actorType: 'DRIVER',
      actorId: driverId,
      action: 'driver_auth.logout',
      tableName: 'driver_sessions',
      recordId: sessionId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  private async issue(
    tx: Tx,
    driver: Driver,
    meta: RequestMeta,
    familyId: string,
    absoluteExpiry: Date | null,
  ): Promise<{ sessionId: string; view: DriverSessionView }> {
    const now = this.clock.now();
    const refreshToken = generateRefreshToken();
    const expiresAt =
      absoluteExpiry ?? new Date(now.getTime() + this.config.driverSessionMaxDays * DAY);
    const row = await tx.driverSession.create({
      data: {
        driverId: driver.id,
        familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip,
        createdAt: now,
        expiresAt,
      },
    });
    const claims: DriverAccessClaims = { sub: driver.id, sid: row.id, typ: 'driver' };
    const accessToken = await this.jwt.signAsync(claims, {
      audience: DRIVER_AUDIENCE,
      expiresIn: this.config.accessTokenTtlSeconds,
    });
    return {
      sessionId: row.id,
      view: {
        accessToken,
        accessTokenExpiresAt: new Date(
          Date.now() + this.config.accessTokenTtlSeconds * 1000,
        ).toISOString(),
        refreshToken,
        refreshTokenExpiresAt: expiresAt.toISOString(),
        driver: {
          id: driver.id,
          name: driver.name,
          language: driver.language as DriverLanguage,
        },
      },
    };
  }
}
