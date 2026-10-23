import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NON_PAYMENT_POLICY,
  checkPrice,
  planCode,
  planNameKey,
  planNameProblems,
  totalPayable,
  type PriceCheck,
} from '@voltneo/shared';
import type { Plan, PlanVersion, PlanVersionPrice, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { BatteryTypesService, basisOf } from '../battery-types/battery-types.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { isUniqueViolation, serializable, type Tx } from '../common/util';
import type { PlanNamesDto, PublishVersionDto, UpdatePlanDto, UpdateVersionDto } from './dto';

type VersionWithPrices = PlanVersion & {
  prices: (PlanVersionPrice & { batteryType: { id: string; name: string; status: string } })[];
};

export interface FloorCheck {
  passes: boolean;
  checkedAt: string;
  rows: (PriceCheck & { batteryTypeName: string; costId: string | null })[];
}

function names(p: { nameBn: string; nameHi: string; nameEn: string }) {
  return { bn: p.nameBn, hi: p.nameHi, en: p.nameEn };
}

@Injectable()
export class PlansService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly types: BatteryTypesService,
  ) {}

  onModuleInit(): void {
    // A price below the cost floor can go live only if a second head-office
    // person approves the exception (spec rule 2, D26).
    this.approvals.register('COST_FLOOR_EXCEPTION', {
      onApprove: async (tx, request, approver) => {
        const version = await tx.planVersion.findUnique({ where: { id: request.targetId } });
        if (
          !version ||
          version.status !== 'PENDING_APPROVAL' ||
          version.approvalRequestId !== request.id
        ) {
          throw new ConflictException('This plan version is no longer waiting for approval');
        }
        await this.publishInTx(tx, version.id, request.requestedById, {
          exceptionApprovedById: approver.id,
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: approver.id,
            action: 'plan_version.cost_floor_exception_approved',
            tableName: 'plan_versions',
            recordId: version.id,
            after: { approvalRequestId: request.id, requestedById: request.requestedById },
          },
          tx,
        );
      },
      onClose: async (tx, request) => {
        await tx.planVersion.updateMany({
          where: {
            id: request.targetId,
            status: 'PENDING_APPROVAL',
            approvalRequestId: request.id,
          },
          data: { status: 'DRAFT', approvalRequestId: null },
        });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  private versionView(v: VersionWithPrices, showCosts: boolean) {
    return {
      id: v.id,
      version: v.version,
      status: v.status,
      termMonths: v.termMonths,
      graceDays: v.graceDays,
      lateFeePerDayPaise: v.lateFeePerDayPaise,
      lateFeeCapDays: v.lateFeeCapDays,
      names: v.nameEn ? { bn: v.nameBn, hi: v.nameHi, en: v.nameEn } : null,
      notes: v.notes,
      prices: v.prices
        .slice()
        .sort((a, b) => a.batteryType.name.localeCompare(b.batteryType.name))
        .map((p) => ({
          batteryTypeId: p.batteryTypeId,
          batteryTypeName: p.batteryType.name,
          batteryTypeStatus: p.batteryType.status,
          downPayment: p.downPayment,
          instalment: p.instalment,
          totalPayable: p.totalPayable,
          costFloor: showCosts ? p.costFloor : undefined,
        })),
      costFloorPassed: showCosts ? v.costFloorPassed : undefined,
      costFloorCheck: showCosts ? v.costFloorCheck : undefined,
      costFloorException: v.costFloorException,
      approvalRequestId: v.approvalRequestId,
      exceptionApprovedById: v.exceptionApprovedById,
      publishedById: v.publishedById,
      publishedAt: v.publishedAt,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  private readonly versionInclude = {
    prices: { include: { batteryType: { select: { id: true, name: true, status: true } } } },
  } as const;

  async list(showCosts: boolean) {
    const plans = await this.prisma.plan.findMany({
      orderBy: { seq: 'asc' },
      include: {
        versions: {
          where: { status: { in: ['PUBLISHED', 'DRAFT', 'PENDING_APPROVAL'] } },
          include: this.versionInclude,
        },
      },
    });
    const current = showCosts
      ? await this.currentChecks(plans.flatMap((p) => p.versions))
      : new Map();
    return plans.map((p) => {
      const published = p.versions.find((v) => v.status === 'PUBLISHED');
      const open = p.versions.find((v) => v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL');
      return {
        id: p.id,
        code: p.code,
        names: names(p),
        status: p.status,
        published: published ? this.versionView(published, showCosts) : null,
        openVersion: open ? { id: open.id, version: open.version, status: open.status } : null,
        // Costs may have risen since the version was published.
        belowFloorNow: showCosts && published ? !current.get(published.id)?.passes : undefined,
        updatedAt: p.updatedAt,
      };
    });
  }

  async get(id: string, showCosts: boolean) {
    const p = await this.prisma.plan.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, include: this.versionInclude } },
    });
    if (!p) throw new NotFoundException('Plan not found');
    return {
      id: p.id,
      code: p.code,
      names: names(p),
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      versions: p.versions.map((v) => this.versionView(v, showCosts)),
    };
  }

  /** Checks a version's price grid against today's cost floors. */
  async check(versionId: string): Promise<FloorCheck> {
    const v = await this.prisma.planVersion.findUnique({
      where: { id: versionId },
      include: this.versionInclude,
    });
    if (!v) throw new NotFoundException('Plan version not found');
    return this.floorCheck(this.prisma, v);
  }

  private async floorCheck(tx: Tx | PrismaService, v: VersionWithPrices): Promise<FloorCheck> {
    if (!v.termMonths)
      throw new UnprocessableEntityException('Set the number of instalments first');
    const costs = await this.types.currentCosts(
      tx,
      v.prices.map((p) => p.batteryTypeId),
    );
    const rows = v.prices.map((p) => {
      const cost = costs.get(p.batteryTypeId);
      if (!cost)
        throw new UnprocessableEntityException(`${p.batteryType.name} has no purchase cost`);
      return {
        ...checkPrice({
          batteryTypeId: p.batteryTypeId,
          downPayment: p.downPayment,
          instalment: p.instalment,
          termMonths: v.termMonths!,
          basis: basisOf(cost),
        }),
        batteryTypeName: p.batteryType.name,
        costId: cost.id,
      };
    });
    return { passes: rows.every((r) => r.passes), checkedAt: new Date().toISOString(), rows };
  }

  private async currentChecks(versions: VersionWithPrices[]) {
    const out = new Map<string, FloorCheck>();
    for (const v of versions.filter((v) => v.status === 'PUBLISHED' && v.termMonths)) {
      try {
        out.set(v.id, await this.floorCheck(this.prisma, v));
      } catch {
        // A version whose type lost its cost row is shown without a verdict.
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------

  private async assertNamesFree(
    tx: Tx,
    n: { bn: string; hi: string; en: string },
    exceptId?: string,
  ) {
    const problems = planNameProblems(n);
    if (problems.length) throw new BadRequestException(problems);
    const others = await tx.plan.findMany({
      where: { status: { not: 'RETIRED' }, id: exceptId ? { not: exceptId } : undefined },
      select: { code: true, nameBn: true, nameHi: true, nameEn: true },
    });
    for (const o of others) {
      for (const [lang, label, mine, theirs] of [
        ['bn', 'Bengali', n.bn, o.nameBn],
        ['hi', 'Hindi', n.hi, o.nameHi],
        ['en', 'English', n.en, o.nameEn],
      ] as const) {
        if (planNameKey(mine) === planNameKey(theirs)) {
          throw new ConflictException(`${label} name is already used by plan ${o.code}`);
        }
        void lang;
      }
    }
  }

  async create(dto: PlanNamesDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const n = {
      bn: dto.nameBn.replace(/\s+/g, ' '),
      hi: dto.nameHi.replace(/\s+/g, ' '),
      en: dto.nameEn.replace(/\s+/g, ' '),
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const plan = await serializable(this.prisma, async (tx) => {
          await this.assertNamesFree(tx, n);
          const last = await tx.plan.aggregate({ _max: { seq: true } });
          const seq = (last._max.seq ?? 0) + 1;
          const p = await tx.plan.create({
            data: {
              seq,
              code: planCode(seq),
              nameBn: n.bn,
              nameHi: n.hi,
              nameEn: n.en,
              createdById: actor.id,
            },
          });
          const v = await tx.planVersion.create({
            data: { planId: p.id, version: 1, ...this.policy(), createdById: actor.id },
          });
          await this.audit.record(
            {
              actorType: 'STAFF',
              actorId: actor.id,
              action: 'plan.create',
              tableName: 'plans',
              recordId: p.id,
              after: { code: p.code, names: n, draftVersionId: v.id },
              ip: meta.ip,
              requestId: meta.requestId,
            },
            tx,
          );
          return p;
        });
        return this.get(plan.id, true);
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 3) continue;
        throw err;
      }
    }
  }

  private policy() {
    return {
      graceDays: NON_PAYMENT_POLICY.graceDays,
      lateFeePerDayPaise: NON_PAYMENT_POLICY.lateFeePerDayPaise,
      lateFeeCapDays: NON_PAYMENT_POLICY.lateFeeCapDays,
    };
  }

  /**
   * Renames apply to new sign-ups only: published versions keep the names
   * copied into them when they went live (D27).
   */
  async update(id: string, dto: UpdatePlanDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const before = await tx.plan.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Plan not found');
      const n = {
        bn: (dto.nameBn ?? before.nameBn).replace(/\s+/g, ' '),
        hi: (dto.nameHi ?? before.nameHi).replace(/\s+/g, ' '),
        en: (dto.nameEn ?? before.nameEn).replace(/\s+/g, ' '),
      };
      const renamed = n.bn !== before.nameBn || n.hi !== before.nameHi || n.en !== before.nameEn;
      let status = before.status;
      if (dto.status && dto.status !== before.status) {
        if (dto.status === 'RETIRED') status = 'RETIRED';
        if (dto.status === 'ACTIVE') {
          const published = await tx.planVersion.count({
            where: { planId: id, status: 'PUBLISHED' },
          });
          if (!published)
            throw new ConflictException('Publish a version before making this plan active');
          status = 'ACTIVE';
        }
      }
      if (renamed || (status !== 'RETIRED' && before.status === 'RETIRED')) {
        await this.assertNamesFree(tx, n, id);
      }
      const after = await tx.plan.update({
        where: { id },
        data: { nameBn: n.bn, nameHi: n.hi, nameEn: n.en, status },
      });
      const action =
        status !== before.status
          ? status === 'RETIRED'
            ? 'plan.retire'
            : 'plan.reactivate'
          : 'plan.rename';
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action,
          tableName: 'plans',
          recordId: id,
          before: { names: names(before), status: before.status },
          after: { names: names(after), status: after.status },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id, true);
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  /** Starts a new draft, copying the terms and prices of the latest version. */
  async newVersion(planId: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { prices: true } } },
      });
      if (!plan) throw new NotFoundException('Plan not found');
      const open = await tx.planVersion.findFirst({
        where: { planId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } },
      });
      if (open)
        throw new ConflictException(
          `Version ${open.version} is still a draft or awaiting approval`,
        );
      const latest = plan.versions[0];
      const v = await tx.planVersion.create({
        data: {
          planId,
          version: (latest?.version ?? 0) + 1,
          termMonths: latest?.termMonths ?? null,
          notes: null,
          ...this.policy(),
          createdById: actor.id,
          prices: latest
            ? {
                create: latest.prices.map((p) => ({
                  batteryTypeId: p.batteryTypeId,
                  downPayment: p.downPayment,
                  instalment: p.instalment,
                  totalPayable: p.totalPayable,
                })),
              }
            : undefined,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'plan_version.create',
          tableName: 'plan_versions',
          recordId: v.id,
          after: { planId, version: v.version, copiedFrom: latest?.id ?? null },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(planId, true);
  }

  async updateVersion(
    id: string,
    dto: UpdateVersionDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const planId = await serializable(this.prisma, async (tx) => {
      const v = await tx.planVersion.findUnique({ where: { id }, include: { prices: true } });
      if (!v) throw new NotFoundException('Plan version not found');
      if (v.status !== 'DRAFT') {
        throw new ConflictException(
          'Only a draft can be changed. Start a new version to change published terms.',
        );
      }
      const term = dto.termMonths ?? v.termMonths;
      if (dto.prices) {
        const ids = dto.prices.map((p) => p.batteryTypeId);
        if (new Set(ids).size !== ids.length)
          throw new BadRequestException('Each battery type can appear only once');
        const found = await tx.batteryType.findMany({ where: { id: { in: ids } } });
        if (found.length !== ids.length)
          throw new BadRequestException('Unknown battery type in the price grid');
        const archived = found.filter((t) => t.status !== 'ACTIVE');
        if (archived.length) {
          throw new UnprocessableEntityException(
            `${archived.map((t) => t.name).join(', ')} is archived`,
          );
        }
      }
      const prices = dto.prices ?? v.prices;
      if (term && (dto.prices || dto.termMonths)) {
        // Recalculate totals whenever the term or a price changes.
        await tx.planVersionPrice.deleteMany({ where: { planVersionId: id } });
        await tx.planVersionPrice.createMany({
          data: prices.map((p) => ({
            planVersionId: id,
            batteryTypeId: p.batteryTypeId,
            downPayment: p.downPayment,
            instalment: p.instalment,
            totalPayable: totalPayable(p.downPayment, p.instalment, term),
          })),
        });
      } else if (dto.prices) {
        throw new UnprocessableEntityException(
          'Set the number of instalments before entering prices',
        );
      }
      const after = await tx.planVersion.update({
        where: { id },
        data: { termMonths: term, notes: dto.notes },
        include: { prices: true },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'plan_version.update',
          tableName: 'plan_versions',
          recordId: id,
          before: { termMonths: v.termMonths, prices: v.prices.map(priceAudit) },
          after: { termMonths: after.termMonths, prices: after.prices.map(priceAudit) },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return v.planId;
    });
    return this.get(planId, true);
  }

  async discardVersion(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const planId = await serializable(this.prisma, async (tx) => {
      const v = await tx.planVersion.findUnique({ where: { id } });
      if (!v) throw new NotFoundException('Plan version not found');
      if (v.status !== 'DRAFT') throw new ConflictException('Only a draft can be discarded');
      const others = await tx.planVersion.count({ where: { planId: v.planId, id: { not: id } } });
      if (!others)
        throw new ConflictException(
          "A plan's first version cannot be discarded; retire the plan instead",
        );
      await tx.planVersion.delete({ where: { id } });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'plan_version.discard',
          tableName: 'plan_versions',
          recordId: id,
          before: { planId: v.planId, version: v.version },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return v.planId;
    });
    return this.get(planId, true);
  }

  /**
   * Publishes a draft. If every price clears its cost floor it goes live at
   * once. If not, it waits for a second head-office person to approve an
   * exception, and the publisher must give a reason.
   */
  async publish(id: string, dto: PublishVersionDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const result = await serializable(this.prisma, async (tx) => {
      const v = await this.readyToPublish(tx, id);
      const check = await this.floorCheck(tx, v);
      if (check.passes) {
        await this.publishInTx(tx, id, actor.id, {}, check);
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'plan_version.publish',
            tableName: 'plan_versions',
            recordId: id,
            after: { planId: v.planId, version: v.version, costFloor: 'passed' },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return { planId: v.planId, outcome: 'PUBLISHED' as const, check };
      }
      if (!dto.exceptionReason) {
        throw new UnprocessableEntityException({
          message:
            'One or more prices are below the cost floor. Give a reason to ask a second person to approve an exception.',
          code: 'BELOW_COST_FLOOR',
          check,
        });
      }
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: v.planId } });
      const request = await this.approvals.create(
        tx,
        {
          type: 'COST_FLOOR_EXCEPTION',
          targetTable: 'plan_versions',
          targetId: id,
          summary: `Publish ${plan.code} "${plan.nameEn}" version ${v.version} below the cost floor`,
          reason: dto.exceptionReason,
          payload: { ...check, planId: v.planId } as unknown as Prisma.InputJsonValue,
        },
        actor,
        meta,
      );
      await tx.planVersion.update({
        where: { id },
        data: {
          status: 'PENDING_APPROVAL',
          approvalRequestId: request.id,
          costFloorPassed: false,
          costFloorCheck: check as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        planId: v.planId,
        outcome: 'PENDING_APPROVAL' as const,
        check,
        approvalRequestId: request.id,
      };
    });
    return { ...result, plan: await this.get(result.planId, true) };
  }

  private async readyToPublish(tx: Tx, id: string): Promise<VersionWithPrices> {
    const v = await tx.planVersion.findUnique({ where: { id }, include: this.versionInclude });
    if (!v) throw new NotFoundException('Plan version not found');
    if (v.status !== 'DRAFT')
      throw new ConflictException(`This version is ${v.status.toLowerCase().replace('_', ' ')}`);
    const problems: string[] = [];
    if (!v.termMonths) problems.push('Set the number of instalments');
    if (!v.prices.length) problems.push('Add a price for at least one battery type');
    const archived = v.prices.filter((p) => p.batteryType.status !== 'ACTIVE');
    if (archived.length)
      problems.push(
        `Remove archived battery types: ${archived.map((p) => p.batteryType.name).join(', ')}`,
      );
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: v.planId } });
    problems.push(...planNameProblems(names(plan)));
    if (problems.length) throw new UnprocessableEntityException(problems);
    return v;
  }

  /** Makes a version live: supersedes the previous one and freezes names and floors. */
  private async publishInTx(
    tx: Tx,
    id: string,
    publisherId: string,
    extra: { exceptionApprovedById?: string },
    knownCheck?: FloorCheck,
  ) {
    const v = await tx.planVersion.findUniqueOrThrow({
      where: { id },
      include: this.versionInclude,
    });
    const plan: Plan = await tx.plan.findUniqueOrThrow({ where: { id: v.planId } });
    // Recheck at the moment of publishing: costs may have changed since the request.
    const check = knownCheck ?? (await this.floorCheck(tx, v));
    for (const row of check.rows) {
      await tx.planVersionPrice.updateMany({
        where: { planVersionId: id, batteryTypeId: row.batteryTypeId },
        data: { costFloor: row.costFloor },
      });
    }
    await tx.planVersion.updateMany({
      where: { planId: v.planId, status: 'PUBLISHED' },
      data: { status: 'SUPERSEDED' },
    });
    await tx.planVersion.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        nameBn: plan.nameBn,
        nameHi: plan.nameHi,
        nameEn: plan.nameEn,
        costFloorPassed: check.passes,
        costFloorCheck: check as unknown as Prisma.InputJsonValue,
        costFloorException: !check.passes,
        exceptionApprovedById: extra.exceptionApprovedById ?? null,
        publishedById: publisherId,
        publishedAt: new Date(),
      },
    });
    if (plan.status === 'DRAFT')
      await tx.plan.update({ where: { id: plan.id }, data: { status: 'ACTIVE' } });
  }
}

function priceAudit(p: {
  batteryTypeId: string;
  downPayment: number;
  instalment: number;
  totalPayable: number;
}) {
  return {
    batteryTypeId: p.batteryTypeId,
    downPayment: p.downPayment,
    instalment: p.instalment,
    totalPayable: p.totalPayable,
  };
}
