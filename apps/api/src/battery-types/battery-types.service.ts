import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { costFloor, type CostBasis } from '@voltneo/shared';
import type { BatteryType, BatteryTypeCost } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { isUniqueViolation, type Tx } from '../common/util';
import type { CostBasisDto, CreateBatteryTypeDto, UpdateBatteryTypeDto } from './dto';

export function costView(c: BatteryTypeCost) {
  return {
    id: c.id,
    purchaseCost: c.purchaseCost,
    gpsCost: c.gpsCost,
    serviceCost: c.serviceCost,
    financingCost: c.financingCost,
    collectionCost: c.collectionCost,
    expectedLossCost: c.expectedLossCost,
    costFloor: c.costFloor,
    note: c.note,
    enteredById: c.enteredById,
    createdAt: c.createdAt,
  };
}

export function basisOf(c: BatteryTypeCost): CostBasis {
  return {
    purchaseCost: c.purchaseCost,
    gpsCost: c.gpsCost,
    serviceCost: c.serviceCost,
    financingCost: c.financingCost,
    collectionCost: c.collectionCost,
    expectedLossCost: c.expectedLossCost,
  };
}

function typeView(t: BatteryType) {
  return {
    id: t.id,
    name: t.name,
    voltage: Number(t.voltage),
    capacityAh: Number(t.capacityAh),
    chemistry: t.chemistry,
    supplier: t.supplier,
    warrantyMonths: t.warrantyMonths,
    warrantyNotes: t.warrantyNotes,
    compatibleVehicles: t.compatibleVehicles,
    notes: t.notes,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function costData(dto: CostBasisDto) {
  const basis: CostBasis = {
    purchaseCost: dto.purchaseCost,
    gpsCost: dto.gpsCost ?? 0,
    serviceCost: dto.serviceCost ?? 0,
    financingCost: dto.financingCost ?? 0,
    collectionCost: dto.collectionCost ?? 0,
    expectedLossCost: dto.expectedLossCost ?? 0,
  };
  return { ...basis, costFloor: costFloor(basis), note: dto.note ?? null };
}

@Injectable()
export class BatteryTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The newest cost row for each battery type. */
  async currentCosts(
    tx: Tx | PrismaService,
    typeIds: string[],
  ): Promise<Map<string, BatteryTypeCost>> {
    if (typeIds.length === 0) return new Map();
    const rows = await tx.batteryTypeCost.findMany({
      where: { batteryTypeId: { in: typeIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['batteryTypeId'],
    });
    return new Map(rows.map((r) => [r.batteryTypeId, r]));
  }

  async list(showCosts: boolean) {
    const types = await this.prisma.batteryType.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const counts = await this.prisma.battery.groupBy({
      by: ['batteryTypeId', 'status'],
      _count: true,
    });
    const costs = showCosts
      ? await this.currentCosts(
          this.prisma,
          types.map((t) => t.id),
        )
      : new Map();
    return types.map((t) => {
      const byStatus: Record<string, number> = {};
      for (const c of counts.filter((c) => c.batteryTypeId === t.id)) byStatus[c.status] = c._count;
      const cost = costs.get(t.id);
      return {
        ...typeView(t),
        batteryCounts: byStatus,
        currentCost: showCosts && cost ? costView(cost) : undefined,
      };
    });
  }

  async get(id: string, showCosts: boolean) {
    const t = await this.prisma.batteryType.findUnique({
      where: { id },
      include: showCosts
        ? { costs: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } }
        : undefined,
    });
    if (!t) throw new NotFoundException('Battery type not found');
    const history = showCosts ? (t as BatteryType & { costs: BatteryTypeCost[] }).costs : [];
    const staffIds = [...new Set(history.map((c) => c.enteredById).filter(Boolean))] as string[];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return {
      ...typeView(t),
      currentCost: history[0] ? costView(history[0]) : undefined,
      costHistory: showCosts
        ? history.map((c) => ({
            ...costView(c),
            enteredByName: c.enteredById ? names.get(c.enteredById) : null,
          }))
        : undefined,
    };
  }

  async create(dto: CreateBatteryTypeDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const { cost, ...fields } = dto;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const t = await tx.batteryType.create({ data: { ...fields, createdById: actor.id } });
        const c = await tx.batteryTypeCost.create({
          data: { ...costData(cost), batteryTypeId: t.id, enteredById: actor.id },
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'battery_type.create',
            tableName: 'battery_types',
            recordId: t.id,
            after: { ...typeView(t), cost: costView(c) },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return t;
      });
      return this.get(created.id, true);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException('A battery type with this name already exists');
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateBatteryTypeDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.batteryType.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Battery type not found');
        const after = await tx.batteryType.update({ where: { id }, data: dto });
        const action =
          dto.status && dto.status !== before.status
            ? dto.status === 'ARCHIVED'
              ? 'battery_type.archive'
              : 'battery_type.restore'
            : 'battery_type.update';
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action,
            tableName: 'battery_types',
            recordId: id,
            before: typeView(before),
            after: typeView(after),
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
      });
      return this.get(id, true);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException('A battery type with this name already exists');
      throw err;
    }
  }

  /** Adds a cost row. Old rows are kept: the database refuses to change them. */
  async addCost(id: string, dto: CostBasisDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const type = await tx.batteryType.findUnique({ where: { id } });
      if (!type) throw new NotFoundException('Battery type not found');
      const previous = (await this.currentCosts(tx, [id])).get(id);
      const c = await tx.batteryTypeCost.create({
        data: { ...costData(dto), batteryTypeId: id, enteredById: actor.id },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'battery_type.cost_change',
          tableName: 'battery_type_costs',
          recordId: c.id,
          before: previous ? costView(previous) : null,
          after: costView(c),
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id, true);
  }
}
