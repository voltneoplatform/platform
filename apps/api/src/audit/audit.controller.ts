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
    const where: Prisma.AuditLogWhereInput = {
      tableName: q.tableName,
      recordId: q.recordId,
      actorId: q.actorId,
      action: q.action,
      at:
        q.from || q.to
          ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined }
          : undefined,
      id: q.before && /^\d+$/.test(q.before) ? { lt: BigInt(q.before) } : undefined,
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit).map((r) => ({ ...r, id: r.id.toString() }));
    return {
      items: page,
      nextBefore: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
