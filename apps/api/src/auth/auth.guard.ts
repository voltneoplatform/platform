import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasPermission, type Permission } from '@voltneo/shared';
import {
  ANY_PERMISSIONS,
  DRIVER_ROUTE,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  type RequestWithContext,
} from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims } from './auth.service';
import { DRIVER_AUDIENCE, type DriverAccessClaims } from '../driver-auth/driver-auth.service';

/**
 * Global guard: every route needs a valid staff login unless marked @Public().
 * The staff member and session are re-checked on each request, so a deactivated
 * account or a logged-out session stops working immediately, not when the token expires.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Login required');

    const driverRoute = this.reflector.getAllAndOverride<boolean>(DRIVER_ROUTE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (driverRoute) return this.driver(req, token);

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Login required');
    }
    if (claims.typ !== 'staff') throw new UnauthorizedException('Login required');

    const session = await this.prisma.staffSession.findUnique({
      where: { id: claims.sid },
      select: {
        revokedAt: true,
        staffId: true,
        staff: { select: { id: true, name: true, role: true, status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.staffId !== claims.sub ||
      session.staff.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Login required');
    }

    req.staff = {
      id: session.staff.id,
      name: session.staff.name,
      role: session.staff.role,
      sessionId: claims.sid,
    };

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (required?.length) {
      // Use the role from the database, not the token, so role changes apply at once.
      const missing = required.filter((p) => !hasPermission(session.staff.role, p));
      if (missing.length) throw new ForbiddenException('Your role does not allow this action');
    }
    const anyOf = this.reflector.getAllAndOverride<Permission[] | undefined>(ANY_PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (anyOf?.length && !anyOf.some((p) => hasPermission(session.staff.role, p))) {
      throw new ForbiddenException('Your role does not allow this action');
    }
    return true;
  }

  /** Driver App routes: a driver token (other audience), a live session and an active driver. */
  private async driver(req: RequestWithContext, token: string): Promise<boolean> {
    let claims: DriverAccessClaims;
    try {
      claims = await this.jwt.verifyAsync<DriverAccessClaims>(token, { audience: DRIVER_AUDIENCE });
    } catch {
      throw new UnauthorizedException('Login required');
    }
    if (claims.typ !== 'driver') throw new UnauthorizedException('Login required');
    const session = await this.prisma.driverSession.findUnique({
      where: { id: claims.sid },
      select: {
        revokedAt: true,
        driverId: true,
        driver: { select: { id: true, name: true, language: true, status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.driverId !== claims.sub ||
      session.driver.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Login required');
    }
    req.driver = {
      id: session.driver.id,
      name: session.driver.name,
      language: session.driver.language,
      sessionId: claims.sid,
    };
    return true;
  }
}
