import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@voltneo/shared';
import type { Request } from 'express';

export const IS_PUBLIC = 'voltneo:isPublic';
export const REQUIRED_PERMISSIONS = 'voltneo:permissions';

/** Route needs no login (health check, OTP request and verify, token refresh). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Staff must hold every listed permission (spec section 2). */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export interface AuthenticatedStaff {
  id: string;
  name: string;
  role: Role;
  sessionId: string;
}

export interface RequestWithContext extends Request {
  staff?: AuthenticatedStaff;
  requestId?: string;
}

export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    if (!req.staff) throw new Error('CurrentStaff used on a route without authentication');
    return req.staff;
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
