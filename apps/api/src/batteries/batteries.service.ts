import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RETIRABLE_STATUSES,
  canMoveBattery,
  IMEI_PATTERN,
  normaliseImei,
  normaliseSerial,
  type BatteryStatus,
} from '@voltneo/shared';
import type { Battery, BatteryType, Prisma } from '../generated/prisma/client';
import type { CustodyHolder } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { BatteryTypesService } from '../battery-types/battery-types.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { dateOnly, isUniqueViolation, parseDateOnly, serializable, type Tx } from '../common/util';
import type {
  BulkCreateBatteriesDto,
  CreateBatteryDto,
  ListBatteriesQuery,
  MoveBatteryDto,
  RetireBatteryDto,
  UpdateBatteryDto,
} from './dto';

type BatteryWithType = Battery & { batteryType: BatteryType };

function view(b: BatteryWithType, showCosts: boolean) {
  return {
    id: b.id,
    serial: b.serial,
    gpsDeviceId: b.gpsDeviceId,
    batteryType: { id: b.batteryType.id, name: b.batteryType.name },
    status: b.status,
    holder: b.holder,
    location: b.location,
    holderStaffId: b.holderStaffId,
    holderDriverId: b.holderDriverId,
    purchaseDate: dateOnly(b.purchaseDate),
    purchaseCost: showCosts ? b.purchaseCost : undefined,
    supplierRef: b.supplierRef,
    notes: b.notes,
    retiredAt: b.retiredAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function duplicateMessage(err: unknown): string {
  const target = JSON.stringify((err as { meta?: unknown }).meta ?? {});
  return target.includes('gps')
    ? 'Another battery already uses this IMEI'
    : 'Another battery already has this serial number';
}

@Injectable()
export class BatteriesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly types: BatteryTypesService,
  ) {}

  onModuleInit(): void {
    // Retiring a battery is a maker-checker action (spec section 2).
    this.approvals.register('BATTERY_RETIRE', {
      onApprove: async (tx, request, approver) => {
        const b = await tx.battery.findUnique({ where: { id: request.targetId } });
        if (!b) throw new NotFoundException('Battery not found');
        if (!RETIRABLE_STATUSES.includes(b.status)) {
          throw new ConflictException(
            `The battery is now ${b.status.toLowerCase().replace('_', ' ')} and cannot be retired`,
          );
        }
        await this.changeState(tx, b, {
          event: 'RETIRED',
          toStatus: 'RETIRED',
          toHolder: 'RETIRED',
          location: b.location,
          staffId: null,
          note: request.reason,
          byId: approver.id,
          extra: { retiredAt: new Date() },
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: approver.id,
            action: 'battery.retire',
            tableName: 'batteries',
            recordId: b.id,
            before: { status: b.status },
            after: {
              status: 'RETIRED',
              approvalRequestId: request.id,
              requestedById: request.requestedById,
            },
          },
          tx,
        );
      },
    });
  }

  async list(q: ListBatteriesQuery, showCosts: boolean) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const search = q.search ? normaliseSerial(q.search) : undefined;
    const where: Prisma.BatteryWhereInput = {
      batteryTypeId: q.batteryTypeId,
      status: q.status,
      OR: search
        ? [{ serial: { contains: search } }, { gpsDeviceId: { contains: search } }]
        : undefined,
    };
    const [total, rows] = await Promise.all([
      this.prisma.battery.count({ where }),
      this.prisma.battery.findMany({
        where,
        include: { batteryType: true },
        orderBy: [{ createdAt: 'desc' }, { serial: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items: rows.map((b) => view(b, showCosts)) };
  }

  async get(id: string, showCosts: boolean) {
    const b = await this.prisma.battery.findUnique({
      where: { id },
      include: { batteryType: true },
    });
    if (!b) throw new NotFoundException('Battery not found');
    const pendingRetire = await this.prisma.approvalRequest.findFirst({
      where: { type: 'BATTERY_RETIRE', targetId: id, status: 'PENDING' },
      select: { id: true, reason: true, requestedById: true, requestedAt: true },
    });
    return {
      ...view(b, showCosts),
      custody: await this.custody(id),
      pendingRetirement: pendingRetire,
    };
  }

  async custody(id: string) {
    const rows = await this.prisma.batteryCustody.findMany({
      where: { batteryId: id },
      orderBy: { at: 'asc' },
    });
    const staffIds = [
      ...new Set(rows.flatMap((r) => [r.byId, r.toStaffId]).filter(Boolean)),
    ] as string[];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return rows.map((r) => ({
      ...r,
      byName: r.byId ? (names.get(r.byId) ?? null) : null,
      toStaffName: r.toStaffId ? (names.get(r.toStaffId) ?? null) : null,
    }));
  }

  private async activeType(tx: Tx, typeId: string) {
    const type = await tx.batteryType.findUnique({ where: { id: typeId } });
    if (!type) throw new BadRequestException('Battery type not found');
    if (type.status !== 'ACTIVE')
      throw new UnprocessableEntityException('This battery type is archived');
    const cost = (await this.types.currentCosts(tx, [typeId])).get(typeId);
    return { type, defaultCost: cost?.purchaseCost };
  }

  async create(dto: CreateBatteryDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const { defaultCost } = await this.activeType(tx, dto.batteryTypeId);
        const b = await this.insert(tx, {
          serial: dto.serial,
          gpsDeviceId: dto.gpsDeviceId ?? null,
          batteryTypeId: dto.batteryTypeId,
          purchaseDate: dto.purchaseDate,
          purchaseCost: dto.purchaseCost ?? defaultCost!,
          location: dto.location ?? null,
          supplierRef: dto.supplierRef ?? null,
          notes: dto.notes ?? null,
          actor,
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'battery.register',
            tableName: 'batteries',
            recordId: b.id,
            after: {
              serial: b.serial,
              gpsDeviceId: b.gpsDeviceId,
              batteryTypeId: b.batteryTypeId,
              location: b.location,
            },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        return b.id;
      });
      return this.get(id, true);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(duplicateMessage(err));
      throw err;
    }
  }

  /**
   * Registers a delivery of batteries in one go. Every row is checked first;
   * if any row has a problem nothing is saved and every problem is listed.
   */
  async bulkCreate(dto: BulkCreateBatteriesDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const items = dto.items.map((i, idx) => ({
      row: idx + 1,
      serial: normaliseSerial(i.serial),
      gpsDeviceId: i.gpsDeviceId ? normaliseImei(i.gpsDeviceId) : null,
    }));
    const errors: { row: number; message: string }[] = [];
    const seenSerial = new Map<string, number>();
    const seenGps = new Map<string, number>();
    const pattern = /^[A-Z0-9][A-Z0-9._/-]{2,59}$/;
    for (const i of items) {
      if (!pattern.test(i.serial))
        errors.push({ row: i.row, message: `Serial "${i.serial}" is not valid` });
      if (i.gpsDeviceId && !IMEI_PATTERN.test(i.gpsDeviceId)) {
        errors.push({
          row: i.row,
          message: `IMEI "${i.gpsDeviceId}" is not valid: it must be exactly 15 digits`,
        });
      }
      if (seenSerial.has(i.serial)) {
        errors.push({
          row: i.row,
          message: `Serial ${i.serial} is repeated (also row ${seenSerial.get(i.serial)})`,
        });
      } else seenSerial.set(i.serial, i.row);
      if (i.gpsDeviceId) {
        if (seenGps.has(i.gpsDeviceId)) {
          errors.push({
            row: i.row,
            message: `IMEI ${i.gpsDeviceId} is repeated (also row ${seenGps.get(i.gpsDeviceId)})`,
          });
        } else seenGps.set(i.gpsDeviceId, i.row);
      }
    }
    const existing = await this.prisma.battery.findMany({
      where: {
        OR: [
          { serial: { in: [...seenSerial.keys()] } },
          { gpsDeviceId: { in: [...seenGps.keys()] } },
        ],
      },
      select: { serial: true, gpsDeviceId: true },
    });
    for (const e of existing) {
      const sRow = seenSerial.get(e.serial);
      if (sRow) errors.push({ row: sRow, message: `Serial ${e.serial} is already registered` });
      const gRow = e.gpsDeviceId ? seenGps.get(e.gpsDeviceId) : undefined;
      if (gRow)
        errors.push({
          row: gRow,
          message: `IMEI ${e.gpsDeviceId} is already used by battery ${e.serial}`,
        });
    }
    if (errors.length) {
      throw new UnprocessableEntityException({
        message: `${errors.length} problem(s) found. Nothing was saved.`,
        errors: errors.sort((a, b) => a.row - b.row),
      });
    }

    try {
      const count = await this.prisma.$transaction(
        async (tx) => {
          const { defaultCost } = await this.activeType(tx, dto.batteryTypeId);
          for (const i of items) {
            await this.insert(tx, {
              serial: i.serial,
              gpsDeviceId: i.gpsDeviceId,
              batteryTypeId: dto.batteryTypeId,
              purchaseDate: dto.purchaseDate,
              purchaseCost: dto.purchaseCost ?? defaultCost!,
              location: dto.location ?? null,
              supplierRef: dto.supplierRef ?? null,
              notes: null,
              actor,
            });
          }
          await this.audit.record(
            {
              actorType: 'STAFF',
              actorId: actor.id,
              action: 'battery.register_bulk',
              tableName: 'batteries',
              after: {
                count: items.length,
                batteryTypeId: dto.batteryTypeId,
                supplierRef: dto.supplierRef,
                serials: items.map((i) => i.serial),
              },
              ip: meta.ip,
              requestId: meta.requestId,
            },
            tx,
          );
          return items.length;
        },
        { timeout: 60_000 },
      );
      return { created: count };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(duplicateMessage(err));
      throw err;
    }
  }

  private async insert(
    tx: Tx,
    d: {
      serial: string;
      gpsDeviceId: string | null;
      batteryTypeId: string;
      purchaseDate: string;
      purchaseCost: number;
      location: string | null;
      supplierRef: string | null;
      notes: string | null;
      actor: AuthenticatedStaff;
    },
  ) {
    const b = await tx.battery.create({
      data: {
        serial: normaliseSerial(d.serial),
        gpsDeviceId: d.gpsDeviceId ? normaliseImei(d.gpsDeviceId) : null,
        batteryTypeId: d.batteryTypeId,
        purchaseDate: parseDateOnly(d.purchaseDate),
        purchaseCost: d.purchaseCost,
        location: d.location,
        supplierRef: d.supplierRef,
        notes: d.notes,
        createdById: d.actor.id,
      },
    });
    await tx.batteryCustody.create({
      data: {
        batteryId: b.id,
        event: 'REGISTERED',
        toStatus: 'IN_STOCK',
        toHolder: 'STOCK',
        toLocation: b.location,
        byId: d.actor.id,
      },
    });
    return b;
  }

  async update(id: string, dto: UpdateBatteryDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.battery.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Battery not found');
        if (before.status === 'RETIRED' || before.status === 'TRANSFERRED') {
          throw new ConflictException('This battery can no longer be changed');
        }
        const serial = dto.serial !== undefined ? normaliseSerial(dto.serial) : undefined;
        if (serial && serial !== before.serial && before.status !== 'IN_STOCK') {
          throw new ConflictException(
            'A serial number can be corrected only while the battery is in stock',
          );
        }
        const after = await tx.battery.update({
          where: { id },
          data: {
            serial,
            gpsDeviceId:
              dto.gpsDeviceId === undefined
                ? undefined
                : dto.gpsDeviceId
                  ? normaliseImei(dto.gpsDeviceId)
                  : null,
            location: dto.location,
            supplierRef: dto.supplierRef,
            notes: dto.notes,
          },
        });
        if (dto.location !== undefined && dto.location !== before.location) {
          await tx.batteryCustody.create({
            data: {
              batteryId: id,
              event: 'MOVED',
              fromStatus: before.status,
              toStatus: before.status,
              fromHolder: before.holder,
              toHolder: before.holder,
              toLocation: after.location,
              toStaffId: before.holderStaffId,
              toDriverId: before.holderDriverId,
              byId: actor.id,
            },
          });
        }
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'battery.update',
            tableName: 'batteries',
            recordId: id,
            before: {
              serial: before.serial,
              gpsDeviceId: before.gpsDeviceId,
              location: before.location,
              notes: before.notes,
              supplierRef: before.supplierRef,
            },
            after: {
              serial: after.serial,
              gpsDeviceId: after.gpsDeviceId,
              location: after.location,
              notes: after.notes,
              supplierRef: after.supplierRef,
            },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
      });
      return this.get(id, true);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(duplicateMessage(err));
      throw err;
    }
  }

  /** Sends a battery to repair or back to stock (the only moves made by hand). */
  async move(id: string, dto: MoveBatteryDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const b = await tx.battery.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Battery not found');
      if (!canMoveBattery(b.status, dto.to)) {
        throw new ConflictException(
          `A battery that is ${b.status.toLowerCase().replace('_', ' ')} cannot be moved to ${dto.to.toLowerCase().replace('_', ' ')} here`,
        );
      }
      const pending = await tx.approvalRequest.count({
        where: { type: 'BATTERY_RETIRE', targetId: id, status: 'PENDING' },
      });
      if (pending) throw new ConflictException('This battery is waiting for a retirement decision');
      if (dto.technicianId) {
        const tech = await tx.staffUser.findUnique({ where: { id: dto.technicianId } });
        if (!tech || tech.role !== 'TECHNICIAN' || tech.status !== 'ACTIVE') {
          throw new BadRequestException('Choose an active technician');
        }
      }
      await this.changeState(tx, b, {
        event: dto.to === 'UNDER_REPAIR' ? 'SENT_FOR_REPAIR' : 'RETURNED_TO_STOCK',
        toStatus: dto.to,
        toHolder: dto.technicianId ? 'TECHNICIAN' : 'STOCK',
        location: dto.location === undefined ? b.location : dto.location,
        staffId: dto.technicianId ?? null,
        note: dto.note ?? null,
        byId: actor.id,
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'battery.status_change',
          tableName: 'batteries',
          recordId: id,
          before: { status: b.status, holder: b.holder, location: b.location },
          after: {
            status: dto.to,
            technicianId: dto.technicianId ?? null,
            location: dto.location ?? b.location,
          },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id, true);
  }

  async requestRetirement(
    id: string,
    dto: RetireBatteryDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    return serializable(this.prisma, async (tx) => {
      const b = await tx.battery.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Battery not found');
      if (!RETIRABLE_STATUSES.includes(b.status)) {
        throw new ConflictException(
          'Only a battery in stock, under repair or recovered can be retired',
        );
      }
      return this.approvals.create(
        tx,
        {
          type: 'BATTERY_RETIRE',
          targetTable: 'batteries',
          targetId: id,
          summary: `Retire battery ${b.serial}`,
          reason: dto.reason,
          payload: { serial: b.serial, statusAtRequest: b.status },
        },
        actor,
        meta,
      );
    });
  }

  private async changeState(
    tx: Tx,
    b: Battery,
    c: {
      event: string;
      toStatus: BatteryStatus;
      toHolder: CustodyHolder;
      location: string | null;
      staffId: string | null;
      note: string | null;
      byId: string;
      extra?: { retiredAt?: Date };
    },
  ) {
    await tx.battery.update({
      where: { id: b.id },
      data: {
        status: c.toStatus,
        holder: c.toHolder,
        location: c.location,
        holderStaffId: c.staffId,
        holderDriverId: null,
        ...c.extra,
      },
    });
    await tx.batteryCustody.create({
      data: {
        batteryId: b.id,
        event: c.event,
        fromStatus: b.status,
        toStatus: c.toStatus,
        fromHolder: b.holder,
        toHolder: c.toHolder,
        toLocation: c.location,
        toStaffId: c.staffId,
        note: c.note,
        byId: c.byId,
      },
    });
  }
}
