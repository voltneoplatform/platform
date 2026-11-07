import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { normaliseIndianMobile, referrerCode } from '@voltneo/shared';
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
 * Referrals (founder, 7 Nov 2026): who referred each driver (an existing
 * driver or an outside referrer), and how many of those drivers were approved
 * and got a battery installed. Tracking only; no rewards are calculated.
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks the referral given when a driver is saved. Returns the columns to
   * write, or null when the request does not touch the referral.
   */
  async check(
    tx: Tx,
    dto: { referredByDriverId?: string | null; referredByReferrerId?: string | null },
    selfId: string | null,
  ) {
    const byDriver = dto.referredByDriverId;
    const byReferrer = dto.referredByReferrerId;
    if (byDriver === undefined && byReferrer === undefined) return null;
    if (byDriver && byReferrer) {
      throw new BadRequestException('Choose one referrer: a driver or an outside referrer');
    }
    if (byDriver) {
      if (byDriver === selfId) throw new BadRequestException('A driver cannot refer themselves');
      const d = await tx.driver.findUnique({ where: { id: byDriver }, select: { id: true } });
      if (!d) throw new UnprocessableEntityException('The referring driver was not found');
      return { referredByDriverId: byDriver, referredByReferrerId: null };
    }
    if (byReferrer) {
      const r = await tx.referrer.findUnique({ where: { id: byReferrer } });
      if (!r) throw new UnprocessableEntityException('The referrer was not found');
      if (!r.active)
        throw new UnprocessableEntityException(`Referrer ${r.code} is marked inactive`);
      return { referredByDriverId: null, referredByReferrerId: byReferrer };
    }
    return { referredByDriverId: null, referredByReferrerId: null };
  }

  /** Referral counts per referrer id, from one column of drivers. */
  private async counts(
    column: 'referred_by_driver_id' | 'referred_by_referrer_id',
    ids?: string[],
  ): Promise<Map<string, Counts>> {
    const col = Prisma.raw(`d."${column}"`);
    const rows = await this.prisma.$queryRaw<
      { id: string; referred: bigint; approved: bigint; installed: bigint }[]
    >`
      SELECT ${col}::text AS id,
             count(*) AS referred,
             count(*) FILTER (WHERE d."approval" = 'APPROVED') AS approved,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "agreements" a
               WHERE a."driver_id" = d."id" AND a."activated_at" IS NOT NULL
             )) AS installed
      FROM "drivers" d
      WHERE ${col} IS NOT NULL
        ${ids ? Prisma.sql`AND ${col} = ANY(${ids}::uuid[])` : Prisma.empty}
      GROUP BY ${col}`;
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

  private async referredDrivers(where: Prisma.DriverWhereInput) {
    const rows = await this.prisma.driver.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        phone: true,
        approval: true,
        createdAt: true,
        agreements: {
          where: { activatedAt: { not: null } },
          select: { id: true },
          take: 1,
        },
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

  /** The drivers this driver referred, for the driver page. */
  async forDriver(driverId: string) {
    const drivers = await this.referredDrivers({ referredByDriverId: driverId });
    return {
      referred: drivers.length,
      approved: drivers.filter((d) => d.approval === 'APPROVED').length,
      installed: drivers.filter((d) => d.installed).length,
      drivers,
    };
  }

  /**
   * Everyone who has referred at least one driver (drivers and outside
   * referrers), most referrals first. Outside referrers with none are listed too.
   */
  async board(q: ReferralSearchQuery) {
    const [byDriver, byReferrer] = await Promise.all([
      this.counts('referred_by_driver_id'),
      this.counts('referred_by_referrer_id'),
    ]);
    const s = q.search?.trim();
    const digits = s?.replace(/\D/g, '');
    const match = s
      ? {
          OR: [
            { name: { contains: s, mode: 'insensitive' as const } },
            { code: { contains: s.toUpperCase() } },
            ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {};
    const [drivers, referrers] = await Promise.all([
      this.prisma.driver.findMany({
        where: { id: { in: [...byDriver.keys()] }, ...match },
        select: { id: true, code: true, name: true, phone: true },
      }),
      this.prisma.referrer.findMany({ where: match }),
    ]);
    const rows = [
      ...drivers.map((d) => ({
        type: 'DRIVER' as const,
        id: d.id,
        code: d.code,
        name: d.name,
        phone: d.phone,
        kind: null,
        active: true,
        ...(byDriver.get(d.id) ?? ZERO),
      })),
      ...referrers.map((r) => ({
        type: 'REFERRER' as const,
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        kind: r.kind,
        active: r.active,
        ...(byReferrer.get(r.id) ?? ZERO),
      })),
    ].sort(
      (a, b) =>
        b.referred - a.referred || b.installed - a.installed || a.name.localeCompare(b.name),
    );
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const totals = rows.reduce(
      (t, r) => ({
        referred: t.referred + r.referred,
        approved: t.approved + r.approved,
        installed: t.installed + r.installed,
      }),
      { ...ZERO },
    );
    return {
      total: rows.length,
      page,
      limit,
      totals,
      items: rows.slice((page - 1) * limit, page * limit),
    };
  }

  /** Picks a referrer while registering: drivers and active outside referrers by name, phone or ID. */
  async search(q: ReferralSearchQuery) {
    const s = q.search?.trim();
    if (!s || s.length < 2) return { items: [] };
    const digits = s.replace(/\D/g, '');
    const or = [
      { name: { contains: s, mode: 'insensitive' as const } },
      { code: { contains: s.toUpperCase() } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ];
    const [drivers, referrers] = await Promise.all([
      this.prisma.driver.findMany({
        where: { OR: or },
        select: { id: true, code: true, name: true, phone: true, district: true },
        take: 10,
        orderBy: { name: 'asc' },
      }),
      this.prisma.referrer.findMany({
        where: { active: true, OR: or },
        take: 10,
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      items: [
        ...drivers.map((d) => ({
          type: 'DRIVER' as const,
          id: d.id,
          code: d.code,
          name: d.name,
          phone: d.phone,
          detail: d.district,
        })),
        ...referrers.map((r) => ({
          type: 'REFERRER' as const,
          id: r.id,
          code: r.code,
          name: r.name,
          phone: r.phone,
          detail: r.kind,
        })),
      ],
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
    const drivers = await this.referredDrivers({ referredByReferrerId: id });
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
