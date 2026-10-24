import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  parseLoginIdentifier,
  type AuthSession,
  type Permission,
  type StaffProfile,
} from '@voltneo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { StaffUser } from '../generated/prisma/client';
import type { SessionClient } from '../generated/prisma/enums';
import type { RequestMeta } from '../common/decorators';
import { OTP_SENDER, type OtpSender } from './otp-sender';
import {
  generateOtpCode,
  generateRefreshToken,
  hashOtp,
  hashRefreshToken,
  safeEqualHex,
} from './crypto';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: StaffUser['role'];
  typ: 'staff';
}

export interface IssuedSession extends AuthSession {
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/** The same message for every failure, so callers cannot tell which part was wrong. */
const BAD_CODE = 'The code is wrong or has expired. Request a new code.';
const SESSION_ENDED = 'Your session has ended. Please log in again.';

export function toStaffProfile(s: StaffUser): StaffProfile {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    role: s.role,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
  };
}

export function permissionsFor(role: StaffUser['role']): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  private async findStaff(
    rawIdentifier: string,
  ): Promise<{ staff: StaffUser | null; channel: 'EMAIL' | 'SMS'; destination: string } | null> {
    const id = parseLoginIdentifier(rawIdentifier);
    if (!id) return null;
    const staff = await this.prisma.staffUser.findUnique({
      where: id.kind === 'email' ? { email: id.value } : { phone: id.value },
    });
    return { staff, channel: id.kind === 'email' ? 'EMAIL' : 'SMS', destination: id.value };
  }

  /**
   * Sends a login code. Always answers the same way, whether or not the
   * identifier belongs to an active staff member, so accounts cannot be probed.
   */
  async requestOtp(
    identifier: string,
    meta: RequestMeta,
  ): Promise<{ sent: true; expiresInSeconds: number }> {
    const answer = { sent: true as const, expiresInSeconds: this.config.otpTtlSeconds };
    const found = await this.findStaff(identifier);
    if (!found?.staff || found.staff.status !== 'ACTIVE') return answer;
    const { staff, channel, destination } = found;

    const latest = await this.prisma.otpChallenge.findFirst({
      where: { staffId: staff.id },
      orderBy: { createdAt: 'desc' },
    });
    const cooldownMs = this.config.otpResendCooldownSeconds * 1000;
    if (latest && Date.now() - latest.createdAt.getTime() < cooldownMs) return answer;

    const code = generateOtpCode();
    const challengeId = randomUUID();
    await this.prisma.$transaction([
      // Only the newest code works.
      this.prisma.otpChallenge.updateMany({
        where: { staffId: staff.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpChallenge.create({
        data: {
          id: challengeId,
          staffId: staff.id,
          channel,
          destination,
          codeHash: hashOtp(this.config.otpHashSecret, challengeId, code),
          expiresAt: new Date(Date.now() + this.config.otpTtlSeconds * 1000),
          requestIp: meta.ip,
        },
      }),
    ]);

    try {
      await this.sender.send({ channel, destination, code, recipientName: staff.name });
    } catch (err) {
      this.logger.error(`OTP delivery failed for staff ${staff.id}`, err as Error);
      throw new HttpException(
        'Could not send the code. Try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return answer;
  }

  async verifyOtp(
    identifier: string,
    code: string,
    client: SessionClient,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const found = await this.findStaff(identifier);
    const staff = found?.staff;
    if (!staff || staff.status !== 'ACTIVE') throw new UnauthorizedException(BAD_CODE);

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { staffId: staff.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new UnauthorizedException(BAD_CODE);

    // Count the attempt atomically before checking, so parallel guesses cannot exceed the limit.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: this.config.otpMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw new UnauthorizedException(BAD_CODE);
    }

    const ok = safeEqualHex(
      challenge.codeHash,
      hashOtp(this.config.otpHashSecret, challenge.id, code),
    );
    if (ok && client === 'WEB' && !hasPermission(staff.role, 'admin_panel.access')) {
      // Field roles sign in on the Field App. The code is used up so it cannot be replayed there.
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw new ForbiddenException('Your role uses the Field App, not the admin panel.');
    }
    if (!ok) {
      await this.audit.record({
        actorType: 'STAFF',
        actorId: staff.id,
        action: 'auth.login_failed',
        tableName: 'staff_users',
        recordId: staff.id,
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new UnauthorizedException(BAD_CODE);
    }

    // Consume exactly once, even if the right code arrives twice at the same moment.
    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new UnauthorizedException(BAD_CODE);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.staffUser.update({
        where: { id: staff.id },
        data: { lastLoginAt: new Date() },
      });
      const issued = await this.createSession(tx, updated, client, meta, randomUUID(), null);
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: staff.id,
          action: 'auth.login',
          tableName: 'staff_sessions',
          recordId: issued.sessionId,
          after: { client, channel: challenge.channel },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return issued.session;
    });
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException(SESSION_ENDED);
    const session = await this.prisma.staffSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { staff: true },
    });
    if (!session || session.revokedAt) throw new UnauthorizedException(SESSION_ENDED);

    if (session.rotatedAt) {
      // An old refresh token was used again: it may have been stolen. End every session in this family.
      await this.prisma.staffSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'refresh_token_reused' },
      });
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'auth.refresh_token_reused',
        tableName: 'staff_sessions',
        recordId: session.id,
        after: { staffId: session.staffId, familyId: session.familyId },
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new UnauthorizedException(SESSION_ENDED);
    }

    const now = Date.now();
    // Field App sessions allow a longer pause: staff work between visits (ASSUMED, T75).
    const idleLimitMs =
      (session.client === 'APP'
        ? this.config.appSessionIdleTimeoutMinutes
        : this.config.sessionIdleTimeoutMinutes) * 60_000;
    const idle = now - session.lastUsedAt.getTime() > idleLimitMs;
    const expired = now >= session.expiresAt.getTime();
    if (idle || expired || session.staff.status !== 'ACTIVE') {
      await this.prisma.staffSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedReason:
            session.staff.status !== 'ACTIVE'
              ? 'staff_deactivated'
              : idle
                ? 'idle_timeout'
                : 'expired',
        },
      });
      throw new UnauthorizedException(SESSION_ENDED);
    }

    return this.prisma.$transaction(async (tx) => {
      const rotated = await tx.staffSession.updateMany({
        where: { id: session.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (rotated.count === 0) throw new UnauthorizedException(SESSION_ENDED);
      const issued = await this.createSession(
        tx,
        session.staff,
        session.client,
        meta,
        session.familyId,
        session.expiresAt,
      );
      return issued.session;
    });
  }

  async logout(sessionId: string, staffId: string, meta: RequestMeta): Promise<void> {
    const session = await this.prisma.staffSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    await this.prisma.staffSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
    await this.audit.record({
      actorType: 'STAFF',
      actorId: staffId,
      action: 'auth.logout',
      tableName: 'staff_sessions',
      recordId: sessionId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  private async createSession(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    staff: StaffUser,
    client: SessionClient,
    meta: RequestMeta,
    familyId: string,
    absoluteExpiry: Date | null,
  ): Promise<{ sessionId: string; session: IssuedSession }> {
    const refreshToken = generateRefreshToken();
    const expiresAt =
      absoluteExpiry ?? new Date(Date.now() + this.config.sessionAbsoluteTimeoutHours * 3_600_000);
    const row = await tx.staffSession.create({
      data: {
        staffId: staff.id,
        familyId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        client,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip,
        expiresAt,
      },
    });
    const claims: AccessTokenClaims = {
      sub: staff.id,
      sid: row.id,
      role: staff.role,
      typ: 'staff',
    };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.config.accessTokenTtlSeconds,
    });
    return {
      sessionId: row.id,
      session: {
        accessToken,
        accessTokenExpiresAt: new Date(
          Date.now() + this.config.accessTokenTtlSeconds * 1000,
        ).toISOString(),
        refreshToken,
        refreshTokenExpiresAt: expiresAt.toISOString(),
        staff: toStaffProfile(staff),
        permissions: permissionsFor(staff.role),
      },
    };
  }
}
