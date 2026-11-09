import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { hasPermission, normaliseIndianMobile, referrerCode } from '@voltneo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { nextCounter } from '../common/counters';
import { serializable, type Tx } from '../common/util';
import type { ReferralSearchQuery, ReferrerDto, UpdateReferrerDto } from './dto';

interface Counts {
  referred: number;
  approved: number;
  installed: number;
}
const ZERO: Counts = { referred: 0, approved: 0, installed: 0 };

/**
 * Referrals (founder, 7 Nov 2026): outside referrers only (mechanics,
 * shopkeepers, agents…), never drivers. Head office (referrals.manage) keeps
 * the list; field staff pick a referrer when registering a driver. Counts how
 * many referred drivers were approved and got a battery installed. Tracking
 * only; no rewards are calculated.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks the referrer given when a driver is saved. Returns the column to
   * write, or null when the request does not touch it. At registration anyone
   * registering may pick one; later changes need referrals.manage.
   */
  async check(
    tx: Tx,
    dto: { referredByReferrerId?: string | null },
    actor: AuthenticatedStaff,
    registering: boolean,
    current: string | null = null,
  ) {
    const id = dto.referredByReferrerId;
    if (id === undefined || (!registering && id === current)) return null;
    if (!registering && !hasPermission(actor.role, 'referrals.manage')) {
      throw new ForbiddenException(
        "Only head office can change a driver's referrer after registration",
      );
    }
    if (id === null) return { referredByReferrerId: null };
    const r = await tx.referrer.findUnique({ where: { id } });
    if (!r) throw new UnprocessableEntityException('The referrer was not found');
    if (!r.active) throw new UnprocessableEntityException(`Referrer ${r.code} is marked inactive`);
    return { referredByReferrerId: id };
  }

  /** Referral counts per referrer. */
  private async counts(): Promise<Map<string, Counts>> {
    const rows = await this.prisma.$queryRaw<
      { id: string; referred: bigint; approved: bigint; installed: bigint }[]
    >`
      SELECT d."referred_by_referrer_id"::text AS id,
             count(*) AS referred,
             count(*) FILTER (WHERE d."approval" = 'APPROVED') AS approved,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "agreements" a
               WHERE a."driver_id" = d."id" AND a."activated_at" IS NOT NULL
             )) AS installed
      FROM "drivers" d
      WHERE d."referred_by_referrer_id" IS NOT NULL
      GROUP BY d."referred_by_referrer_id"`;
    return new Map(
      rows.map((r) => [
        r.id,
        {
          referred: Number(r.referred),
          approved: Number(r.approved),
          installed: Number(r.installed),
        },
      ]),
    );
  }

  private async referredDrivers(referrerId: string) {
    const rows = await this.prisma.driver.findMany({
      where: { referredByReferrerId: referrerId },
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        approval: true,
        createdAt: true,
        agreements: { where: { activatedAt: { not: null } }, select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      phone: d.phone,
      approval: d.approval,
      installed: d.agreements.length > 0,
      registeredAt: d.createdAt,
    }));
  }

  private match(search?: string): Prisma.ReferrerWhereInput {
    const s = search?.trim();
    if (!s) return {};
    const digits = s.replace(/\D/g, '');
    return {
      OR: [
        { name: { contains: s, mode: 'insensitive' } },
        { code: { contains: s.toUpperCase() } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    };
  }

  /** Every outside referrer with counts, most referrals first. */
  async board(q: ReferralSearchQuery) {
    const [counts, referrers] = await Promise.all([
      this.counts(),
      this.prisma.referrer.findMany({ where: this.match(q.search) }),
    ]);
    const rows = referrers
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        kind: r.kind,
        active: r.active,
        ...(counts.get(r.id) ?? ZERO),
      }))
      .sort(
        (a, b) =>
          b.referred - a.referred || b.installed - a.installed || a.name.localeCompare(b.name),
      );
    const totals = [...counts.values()].reduce(
      (t, c) => ({
        referred: t.referred + c.referred,
        approved: t.approved + c.approved,
        installed: t.installed + c.installed,
      }),
      { ...ZERO },
    );
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    return {
      total: rows.length,
      page,
      limit,
      totals,
      items: rows.slice((page - 1) * limit, page * limit),
    };
  }

  /** Active referrers matching a name, mobile or ID, to pick while registering. */
  async search(q: ReferralSearchQuery) {
    const s = q.search?.trim();
    if (!s || s.length < 2) return { items: [] };
    const rows = await this.prisma.referrer.findMany({
      where: { active: true, ...this.match(s) },
      take: 15,
      orderBy: { name: 'asc' },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        kind: r.kind,
      })),
    };
  }

  private phoneOf(raw: string) {
    const p = normaliseIndianMobile(raw);
    if (!p) throw new BadRequestException('Phone must be a 10-digit Indian mobile number');
    return p;
  }

  async getReferrer(id: string) {
    const r = await this.prisma.referrer.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Referrer not found');
    const drivers = await this.referredDrivers(id);
    return {
      ...r,
      referred: drivers.length,
      approved: drivers.filter((d) => d.approval === 'APPROVED').length,
      installed: drivers.filter((d) => d.installed).length,
      drivers,
    };
  }

  async createReferrer(dto: ReferrerDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const phone = this.phoneOf(dto.phone);
    const id = await serializable(this.prisma, async (tx) => {
      const existing = await tx.referrer.findUnique({ where: { phone } });
      if (existing) {
        throw new ConflictException({
          message: `${existing.name} (${existing.code}) already has this phone number`,
          code: 'REFERRER_EXISTS',
          referrer: { id: existing.id, code: existing.code, name: existing.name },
        });
      }
      const r = await tx.referrer.create({
        data: {
          code: referrerCode(await nextCounter(tx, 'referrer')),
          name: dto.name,
          phone,
          kind: dto.kind,
          notes: dto.notes || null,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'referrer.create',
          tableName: 'referrers',
          recordId: r.id,
          after: r,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return r.id;
    });
    return this.getReferrer(id);
  }

  async updateReferrer(
    id: string,
    dto: UpdateReferrerDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    await serializable(this.prisma, async (tx) => {
      const before = await tx.referrer.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Referrer not found');
      const phone = dto.phone !== undefined ? this.phoneOf(dto.phone) : undefined;
      if (phone && phone !== before.phone) {
        const other = await tx.referrer.findUnique({ where: { phone } });
        if (other) {
          throw new ConflictException(
            `${other.name} (${other.code}) already has this phone number`,
          );
        }
      }
      const after = await tx.referrer.update({
        where: { id },
        data: {
          name: dto.name,
          phone,
          kind: dto.kind,
          notes: dto.notes === undefined ? undefined : dto.notes || null,
          active: dto.active,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'referrer.update',
          tableName: 'referrers',
          recordId: id,
          before,
          after,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.getReferrer(id);
  }
}
