import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@voltneo/shared';
import type { Request } from 'express';

export const IS_PUBLIC = 'voltneo:isPublic';
export const DRIVER_ROUTE = 'voltneo:driverRoute';
export const REQUIRED_PERMISSIONS = 'voltneo:permissions';
export const ANY_PERMISSIONS = 'voltneo:anyPermissions';

/** Route needs no login (health check, OTP request and verify, token refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Driver App route: needs a driver's sign-in, never a staff one (M6). */
export const DriverRoute = () => SetMetadata(DRIVER_ROUTE, true);

/** Staff must hold every listed permission (spec section 2). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Staff must hold at least one of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS, permissions);

export interface AuthenticatedStaff {
  id: string;
  name: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedDriver {
  id: string;
  name: string;
  language: 'BN' | 'HI' | 'EN';
  sessionId: string;
}

export interface RequestWithContext extends Request {
  staff?: AuthenticatedStaff;
  driver?: AuthenticatedDriver;
  requestId?: string;
}

export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.staff) throw new Error('CurrentStaff used on a route without authentication');
    return req.staff;
  },
);

export const CurrentDriver = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedDriver => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.driver) throw new Error('CurrentDriver used on a route without driver sign-in');
    return req.driver;
  },
);

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const ReqMeta = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestMeta => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    return {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      requestId: req.requestId ?? null,
    };
  },
);
