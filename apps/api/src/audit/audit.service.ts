import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { ActorType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  tableName: string;
  recordId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

/** Fields that must never be copied into the audit log. */
const REDACTED_KEYS = new Set(['codeHash', 'refreshTokenHash', 'password', 'token']);

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  return JSON.parse(
    JSON.stringify(value, (key, v: unknown) => {
      if (REDACTED_KEYS.has(key)) return '[redacted]';
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  ) as Prisma.InputJsonValue;
}

/**
 * Writes to the append-only audit log (spec section 3, rule 17). Pass the
 * transaction client so the audit row commits or rolls back with the change.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx: Tx = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        action: entry.action,
        tableName: entry.tableName,
        recordId: entry.recordId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: entry.ip ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  }
}
