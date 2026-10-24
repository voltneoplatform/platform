import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RequirePermissions } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

class AuditQuery {
  @IsOptional() @IsString() tableName?: string;
  @IsOptional() @IsString() recordId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  /** Return entries older than this ID (for paging). */
  @IsOptional() @IsString() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-log')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Read-only: the audit log has no update or delete routes, and the database blocks both. */
  @Get()
  @RequirePermissions('audit.read')
  async list(@Query() q: AuditQuery) {
    const limit = q.limit ?? 50;
    // A bare date means that whole day in India.
    const dayOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const from = q.from ? new Date(dayOnly(q.from) ? `${q.from}T00:00:00+05:30` : q.from) : null;
    const to = q.to
      ? dayOnly(q.to)
        ? { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000) }
        : { lte: new Date(q.to) }
      : {};
    const where: Prisma.AuditLogWhereInput = {
      tableName: q.tableName,
      recordId: q.recordId,
      actorId: q.actorId,
      action: q.action,
      at: from || q.to ? { gte: from ?? undefined, ...to } : undefined,
      id: q.before && /^\d+$/.test(q.before) ? { lt: BigInt(q.before) } : undefined,
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const staff = actorIds.length
      ? await this.prisma.staffUser.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, role: true },
        })
      : [];
    const page = rows.slice(0, limit).map((r) => {
      const who = staff.find((s) => s.id === r.actorId);
      return {
        ...r,
        id: r.id.toString(),
        actorName: who?.name ?? null,
        actorRole: who?.role ?? null,
      };
    });
    return {
      items: page,
      nextBefore: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** Record types and actions present in the log, for the filters. */
  @Get('facets')
  @RequirePermissions('audit.read')
  async facets() {
    const [tables, actions] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['tableName'],
        _count: true,
        orderBy: { tableName: 'asc' },
      }),
      this.prisma.auditLog.groupBy({
        by: ['tableName', 'action'],
        _count: true,
        orderBy: { action: 'asc' },
      }),
    ]);
    return {
      tables: tables.map((t) => ({ tableName: t.tableName, count: t._count })),
      actions: actions.map((a) => ({ tableName: a.tableName, action: a.action, count: a._count })),
    };
  }
}
