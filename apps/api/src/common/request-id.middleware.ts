import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithContext } from './decorators';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Gives every request an ID, echoed in the response and written to the audit log. */
export function requestIdMiddleware(req: RequestWithContext, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
