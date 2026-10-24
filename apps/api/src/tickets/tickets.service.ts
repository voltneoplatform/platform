import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  SERVICEABLE_STATES,
  SERVICE_RESPONSE_HOURS,
  hasPermission,
  ticketDueBy,
  ticketNumber,
  ticketTiming,
  type AgreementState,
  type TicketTiming,
} from '@voltneo/shared';
import type { Prisma, ServiceTicket } from '../generated/prisma/client';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import { TEXTS } from '../documents/texts';
import {
  FILE_STORAGE,
  FileLinks,
  checkUpload,
  newFileKey,
  type FileStorage,
} from '../files/file-storage';
import type { UploadedFile } from '../drivers/drivers.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import { nextCounter } from '../common/counters';
import { serializable, type Tx } from '../common/util';
import type {
  AssignTicketDto,
  CancelTicketDto,
  CreateTicketDto,
  ListTicketsQuery,
  ReplaceBatteryDto,
  ResolveTicketDto,
  VisitDto,
} from './dto';

const MINUTE = 60_000;
const MAX_PHOTOS = 6;
const ACTIVE = ['OPEN', 'ASSIGNED'] as const;

const ticketInclude = {
  agreement: {
    select: {
      id: true,
      number: true,
      state: true,
      batteryId: true,
      batteryTypeId: true,
      driver: { select: { id: true, name: true, phone: true, language: true } },
    },
  },
  visits: { orderBy: { visitedAt: 'asc' }, include: { photos: true } },
  replacements: { orderBy: { replacedAt: 'asc' } },
} satisfies Prisma.ServiceTicketInclude;

type TicketFull = Prisma.ServiceTicketGetPayload<{ include: typeof ticketInclude }>;

type Actor = { id: string; ip?: string | null; requestId?: string | null };

/**
 * Service tickets (spec module 10): a reported fault gets a technician response
 * within 48 hours (D48), a record of every visit with readings, and a repair or
 * a replacement battery on the same agreement (clauses C6, C8).
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly links: FileLinks,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  private timing(t: ServiceTicket): TicketTiming {
    return ticketTiming({
      dueBy: t.dueBy,
      respondedAt: t.respondedAt,
      cancelled: t.status === 'CANCELLED',
      now: this.clock.now(),
    });
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    const rows = unique.length
      ? await this.prisma.staffUser.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async serials(ids: string[]) {
    const rows = ids.length
      ? await this.prisma.battery.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: { id: true, serial: true },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.serial]));
  }

  private summary(
    t: ServiceTicket & {
      agreement: {
        id: string;
        number: string;
        driver: { id: string; name: string; phone: string };
      };
    },
    names: Map<string, string>,
    serials: Map<string, string>,
  ) {
    return {
      id: t.id,
      number: t.number,
      agreement: { id: t.agreement.id, number: t.agreement.number },
      driver: t.agreement.driver,
      batterySerial: serials.get(t.batteryId) ?? null,
      category: t.category,
      channel: t.channel,
      description: t.description,
      reportedAt: t.reportedAt,
      dueBy: t.dueBy,
      status: t.status,
      timing: this.timing(t),
      technicianId: t.technicianId,
      technicianName: t.technicianId ? (names.get(t.technicianId) ?? null) : null,
      respondedAt: t.respondedAt,
      outcome: t.outcome,
      resolvedAt: t.resolvedAt,
    };
  }

  async list(q: ListTicketsQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const s = q.search?.trim();
    const now = this.clock.now();
    const timingWhere: Prisma.ServiceTicketWhereInput | undefined =
      q.timing === 'MISSED'
        ? { status: { in: [...ACTIVE] }, respondedAt: null, dueBy: { lt: now } }
        : q.timing === 'DUE_SOON'
          ? {
              status: { in: [...ACTIVE] },
              respondedAt: null,
              dueBy: { gte: now, lte: new Date(now.getTime() + 6 * 3_600_000) },
            }
          : q.timing === 'ON_TIME'
            ? {
                status: { in: [...ACTIVE] },
                respondedAt: null,
                dueBy: { gt: new Date(now.getTime() + 6 * 3_600_000) },
              }
            : undefined;
    const where: Prisma.ServiceTicketWhereInput = {
      AND: [
        q.status ? { status: q.status } : {},
        q.active === 'true' ? { status: { in: [...ACTIVE] } } : {},
        q.active === 'false' ? { status: { notIn: [...ACTIVE] } } : {},
        timingWhere ?? {},
        q.technicianId ? { technicianId: q.technicianId } : {},
        q.agreementId ? { agreementId: q.agreementId } : {},
        s
          ? {
              OR: [
                { number: { contains: s, mode: 'insensitive' } },
                { agreement: { number: { contains: s, mode: 'insensitive' } } },
                { agreement: { driver: { name: { contains: s, mode: 'insensitive' } } } },
                { agreement: { driver: { phone: { contains: s.replace(/\D/g, '') || s } } } },
              ],
            }
          : {},
      ],
    };
    const activeWhere: Prisma.ServiceTicketWhereInput = { status: { in: [...ACTIVE] } };
    const [total, rows, open, assigned, missed] = await Promise.all([
      this.prisma.serviceTicket.count({ where }),
      this.prisma.serviceTicket.findMany({
        where,
        include: {
          agreement: {
            select: {
              id: true,
              number: true,
              driver: { select: { id: true, name: true, phone: true } },
            },
          },
        },
        // Active tickets by deadline first; finished ones newest first.
        orderBy: [{ status: 'asc' }, { dueBy: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.serviceTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.serviceTicket.count({ where: { status: 'ASSIGNED' } }),
      this.prisma.serviceTicket.count({
        where: { ...activeWhere, respondedAt: null, dueBy: { lt: now } },
      }),
    ]);
    const [names, serials] = await Promise.all([
      this.names(rows.map((r) => r.technicianId)),
      this.serials(rows.map((r) => r.batteryId)),
    ]);
    return {
      total,
      page,
      limit,
      counts: { open, assigned, missed },
      items: rows.map((r) => this.summary(r, names, serials)),
    };
  }

  private async load(id: string, tx: Tx | PrismaService = this.prisma): Promise<TicketFull> {
    const t = await tx.serviceTicket.findUnique({ where: { id }, include: ticketInclude });
    if (!t) throw new NotFoundException('Ticket not found');
    return t;
  }

  async get(id: string, viewer?: AuthenticatedStaff) {
    const t = await this.load(id);
    const [names, serials] = await Promise.all([
      this.names([
        t.technicianId,
        t.resolvedById,
        t.createdById,
        ...t.visits.flatMap((v) => [v.technicianId, v.recordedById]),
        ...t.replacements.flatMap((r) => [r.technicianId, r.recordedById]),
      ]),
      this.serials([
        t.batteryId,
        ...t.visits.map((v) => v.batteryId),
        ...t.replacements.flatMap((r) => [r.oldBatteryId, r.newBatteryId]),
      ]),
    ]);
    const isActive = t.status === 'OPEN' || t.status === 'ASSIGNED';
    const serviceable = SERVICEABLE_STATES.includes(t.agreement.state as AgreementState);
    const can = (p: Parameters<typeof hasPermission>[1]) =>
      viewer ? hasPermission(viewer.role, p) : false;
    return {
      ...this.summary(t, names, serials),
      agreement: {
        id: t.agreement.id,
        number: t.agreement.number,
        state: t.agreement.state,
        batteryTypeId: t.agreement.batteryTypeId,
      },
      batteryId: t.batteryId,
      agreementBatteryId: t.agreement.batteryId,
      cancelledAt: t.cancelledAt,
      cancelReason: t.cancelReason,
      resolution: t.resolution,
      resolvedByName: t.resolvedById ? (names.get(t.resolvedById) ?? null) : null,
      createdAt: t.createdAt,
      createdByName: t.createdById ? (names.get(t.createdById) ?? null) : null,
      visits: t.visits.map((v) => ({
        id: v.id,
        visitedAt: v.visitedAt,
        technicianName: names.get(v.technicianId) ?? null,
        batterySerial: serials.get(v.batteryId) ?? null,
        voltageReading: v.voltageReading?.toString() ?? null,
        readingsNote: v.readingsNote,
        finding: v.finding,
        recordedByName: names.get(v.recordedById) ?? null,
        photos: v.photos.map((p) => ({ id: p.id, fileName: p.fileName })),
      })),
      replacements: t.replacements.map((r) => ({
        id: r.id,
        replacedAt: r.replacedAt,
        oldBatterySerial: serials.get(r.oldBatteryId) ?? null,
        newBatterySerial: serials.get(r.newBatteryId) ?? null,
        technicianName: names.get(r.technicianId) ?? null,
        voltageReading: r.voltageReading.toString(),
        oldBatteryNote: r.oldBatteryNote,
      })),
      allowed: {
        assign: isActive && can('tickets.manage'),
        visit: t.status === 'ASSIGNED' && can('tickets.resolve'),
        replace:
          t.status === 'ASSIGNED' &&
          can('tickets.resolve') &&
          t.agreement.state !== 'IMMOBILISED' &&
          serviceable &&
          t.agreement.batteryId === t.batteryId &&
          t.replacements.length === 0,
        resolve: t.status === 'ASSIGNED' && !!t.respondedAt && can('tickets.resolve'),
        cancel: isActive && can('tickets.manage'),
      },
    };
  }

  private async record(
    tx: Tx,
    actor: Actor,
    action: string,
    recordId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.audit.record(
      {
        actorType: 'STAFF',
        actorId: actor.id,
        action,
        tableName: 'service_tickets',
        recordId,
        before: before ?? undefined,
        after,
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  }

  private async technician(tx: Tx, id: string) {
    const s = await tx.staffUser.findUnique({ where: { id } });
    if (!s || s.status !== 'ACTIVE' || !hasPermission(s.role, 'tickets.resolve')) {
      throw new BadRequestException('Choose an active technician');
    }
    return s;
  }

  private checkTime(at: Date, notBefore: Date, what: string) {
    if (at.getTime() > this.clock.now().getTime() + MINUTE) {
      throw new BadRequestException(`The ${what} time cannot be in the future`);
    }
    if (at.getTime() < notBefore.getTime() - MINUTE) {
      throw new BadRequestException(`The ${what} cannot be before the fault was reported`);
    }
  }

  /** A technician may record only on tickets assigned to them; managers on any. */
  private checkOwnTicket(t: ServiceTicket, actor: AuthenticatedStaff) {
    if (actor.role === 'TECHNICIAN' && t.technicianId !== actor.id) {
      throw new ForbiddenException('This ticket is assigned to another technician');
    }
  }

  // ---------------------------------------------------------------------------
  // Report and assign
  // ---------------------------------------------------------------------------

  async create(dto: CreateTicketDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const now = this.clock.now();
    const reportedAt = dto.reportedAt ? new Date(dto.reportedAt) : now;
    if (reportedAt.getTime() > now.getTime() + MINUTE) {
      throw new BadRequestException('The report time cannot be in the future');
    }
    const result = await serializable(this.prisma, async (tx) => {
      const a = await tx.agreement.findUnique({
        where: { id: dto.agreementId },
        include: { driver: true },
      });
      if (!a) throw new NotFoundException('Agreement not found');
      if (!SERVICEABLE_STATES.includes(a.state as AgreementState) || !a.batteryId) {
        throw new ConflictException(
          ['PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED'].includes(a.state)
            ? 'The battery belongs to the driver now: Volt Neo service has ended (D32)'
            : 'Service applies only while a Volt Neo battery is fitted under this agreement',
        );
      }
      if (a.activatedAt && reportedAt.getTime() < a.activatedAt.getTime() - MINUTE) {
        throw new BadRequestException('The report time is before the battery was installed');
      }
      const technician = dto.technicianId ? await this.technician(tx, dto.technicianId) : null;
      const number = ticketNumber(await nextCounter(tx, 'ticket'));
      const ticket = await tx.serviceTicket.create({
        data: {
          number,
          agreementId: a.id,
          driverId: a.driverId,
          batteryId: a.batteryId,
          category: dto.category,
          channel: dto.channel,
          description: dto.description,
          reportedAt,
          dueBy: ticketDueBy(reportedAt),
          status: technician ? 'ASSIGNED' : 'OPEN',
          technicianId: technician?.id ?? null,
          assignedAt: technician ? now : null,
          createdById: actor.id,
        },
      });
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        'ticket.create',
        ticket.id,
        null,
        ticket,
      );
      const lang = a.driver.language as DriverLanguage;
      const messageId = await this.messaging.queue(tx, {
        driverId: a.driverId,
        toPhone: a.driver.phone,
        channel: 'SMS',
        template: 'ticket_received',
        language: lang,
        body: TEXTS[lang].ticketReceivedSms({ ticket: number, hours: SERVICE_RESPONSE_HOURS }),
        agreementId: a.id,
      });
      return { id: ticket.id, messageId };
    });
    await this.messaging.deliver([result.messageId]);
    return this.get(result.id, actor);
  }

  async assign(id: string, dto: AssignTicketDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const t = await this.load(id, tx);
      if (t.status !== 'OPEN' && t.status !== 'ASSIGNED') {
        throw new ConflictException('This ticket is already finished');
      }
      const tech = await this.technician(tx, dto.technicianId);
      if (t.technicianId === tech.id) return;
      const after = await tx.serviceTicket.update({
        where: { id },
        data: { status: 'ASSIGNED', technicianId: tech.id, assignedAt: this.clock.now() },
      });
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        t.technicianId ? 'ticket.reassign' : 'ticket.assign',
        id,
        { status: t.status, technicianId: t.technicianId },
        { status: after.status, technicianId: after.technicianId },
      );
    });
    return this.get(id, actor);
  }

  // ---------------------------------------------------------------------------
  // Visits and replacement
  // ---------------------------------------------------------------------------

  private photosOf(files: UploadedFile[] | undefined) {
    const photos = (files ?? []).map((f) => ({ file: f, upload: checkUpload(f) }));
    if (photos.length > MAX_PHOTOS) {
      throw new BadRequestException(`Attach at most ${MAX_PHOTOS} photos`);
    }
    if (photos.some((p) => p.upload.ext === 'pdf')) {
      throw new BadRequestException('Photos must be JPEG, PNG or WebP images');
    }
    return photos;
  }

  async recordVisit(
    id: string,
    dto: VisitDto,
    files: UploadedFile[] | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const photos = this.photosOf(files);
    const visitedAt = new Date(dto.visitedAt);
    const keys = photos.map((p) => newFileKey('tickets', id, p.upload.ext));
    let stored = false;
    await serializable(this.prisma, async (tx) => {
      const t = await this.load(id, tx);
      if (t.status !== 'ASSIGNED') {
        throw new ConflictException(
          t.status === 'OPEN'
            ? 'Assign a technician before recording a visit'
            : 'This ticket is already finished',
        );
      }
      this.checkOwnTicket(t, actor);
      this.checkTime(visitedAt, t.reportedAt, 'visit');
      const tech = await this.technician(tx, dto.technicianId ?? t.technicianId!);
      if (!stored) {
        for (let i = 0; i < photos.length; i++) {
          await this.storage.put(keys[i]!, photos[i]!.file.buffer, photos[i]!.upload.mime);
        }
        stored = true;
      }
      const visit = await tx.ticketVisit.create({
        data: {
          ticketId: id,
          batteryId: t.agreement.batteryId ?? t.batteryId,
          technicianId: tech.id,
          visitedAt,
          voltageReading: dto.voltageReading ?? null,
          readingsNote: dto.readingsNote ?? null,
          finding: dto.finding,
          recordedById: actor.id,
          photos: {
            create: photos.map((p, i) => ({
              fileKey: keys[i]!,
              fileName: p.upload.originalName,
              fileType: p.upload.mime,
              fileSize: p.upload.size,
            })),
          },
        },
      });
      // The first visit or call is the response the 48 hours measure (D48).
      if (!t.respondedAt) {
        await tx.serviceTicket.update({ where: { id }, data: { respondedAt: visitedAt } });
      }
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        'ticket.visit',
        id,
        null,
        { visit, firstResponse: !t.respondedAt },
      );
    });
    return this.get(id, actor);
  }

  /**
   * Swaps the faulty battery for an in-stock one of the same type, on the same
   * agreement and payment schedule (clause C8). The battery taken out goes
   * under repair with the technician.
   */
  async replaceBattery(
    id: string,
    dto: ReplaceBatteryDto,
    files: UploadedFile[] | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const photos = this.photosOf(files);
    const replacedAt = new Date(dto.replacedAt);
    const keys = photos.map((p) => newFileKey('tickets', id, p.upload.ext));
    let stored = false;
    await serializable(this.prisma, async (tx) => {
      const t = await this.load(id, tx);
      if (t.status !== 'ASSIGNED') {
        throw new ConflictException(
          t.status === 'OPEN'
            ? 'Assign a technician before replacing the battery'
            : 'This ticket is already finished',
        );
      }
      if (t.replacements.length) {
        throw new ConflictException('The battery has already been replaced on this ticket');
      }
      this.checkOwnTicket(t, actor);
      this.checkTime(replacedAt, t.reportedAt, 'replacement');
      const a = await tx.agreement.findUnique({
        where: { id: t.agreementId },
        include: { battery: true },
      });
      if (!a || !a.battery) throw new NotFoundException('Agreement battery not found');
      if (a.state === 'IMMOBILISED') {
        throw new ConflictException(
          'The battery is disabled for unpaid dues. Switch it back on before replacing it.',
        );
      }
      if (!SERVICEABLE_STATES.includes(a.state as AgreementState)) {
        throw new ConflictException('Volt Neo service has ended on this agreement');
      }
      if (a.battery.id !== t.batteryId) {
        throw new ConflictException('The battery on this agreement changed after the report');
      }
      const fresh = await tx.battery.findUnique({ where: { id: dto.newBatteryId } });
      if (!fresh) throw new NotFoundException('Battery not found');
      if (fresh.status !== 'IN_STOCK') {
        throw new ConflictException(`Battery ${fresh.serial} is not in stock`);
      }
      if (fresh.batteryTypeId !== a.batteryTypeId) {
        throw new UnprocessableEntityException(
          `Battery ${fresh.serial} is not the battery type in this agreement`,
        );
      }
      if (!fresh.gpsDeviceId) {
        throw new UnprocessableEntityException(
          `Battery ${fresh.serial} has no GPS device recorded (D13)`,
        );
      }
      const tech = await this.technician(tx, dto.technicianId ?? t.technicianId!);
      if (!stored) {
        for (let i = 0; i < photos.length; i++) {
          await this.storage.put(keys[i]!, photos[i]!.file.buffer, photos[i]!.upload.mime);
        }
        stored = true;
      }

      const old = a.battery;
      const replacement = await tx.batteryReplacement.create({
        data: {
          agreementId: a.id,
          ticketId: id,
          oldBatteryId: old.id,
          newBatteryId: fresh.id,
          technicianId: tech.id,
          replacedAt,
          voltageReading: dto.voltageReading,
          oldBatteryNote: dto.oldBatteryNote,
          recordedById: actor.id,
        },
      });
      await tx.ticketVisit.create({
        data: {
          ticketId: id,
          batteryId: fresh.id,
          technicianId: tech.id,
          visitedAt: replacedAt,
          voltageReading: dto.voltageReading,
          finding: `Replaced battery ${old.serial} with ${fresh.serial}. Old battery: ${dto.oldBatteryNote}`,
          recordedById: actor.id,
          photos: {
            create: photos.map((p, i) => ({
              fileKey: keys[i]!,
              fileName: p.upload.originalName,
              fileType: p.upload.mime,
              fileSize: p.upload.size,
            })),
          },
        },
      });
      if (!t.respondedAt) {
        await tx.serviceTicket.update({ where: { id }, data: { respondedAt: replacedAt } });
      }

      // Custody: the old battery goes under repair with the technician; the
      // new one is with the driver in the same vehicle (rule 17).
      await tx.battery.update({
        where: { id: old.id },
        data: {
          status: 'UNDER_REPAIR',
          holder: 'TECHNICIAN',
          holderStaffId: tech.id,
          holderDriverId: null,
          location: null,
        },
      });
      await tx.batteryCustody.create({
        data: {
          batteryId: old.id,
          event: 'REPLACED_OUT',
          fromStatus: old.status,
          toStatus: 'UNDER_REPAIR',
          fromHolder: old.holder,
          toHolder: 'TECHNICIAN',
          toStaffId: tech.id,
          note: `Agreement ${a.number}, ticket ${t.number}: ${dto.oldBatteryNote}`,
          byId: actor.id,
        },
      });
      await tx.battery.update({
        where: { id: fresh.id },
        data: {
          status: 'INSTALLED',
          holder: 'DRIVER',
          holderDriverId: a.driverId,
          holderStaffId: null,
          location: old.location,
        },
      });
      await tx.batteryCustody.create({
        data: {
          batteryId: fresh.id,
          event: 'INSTALLED_AS_REPLACEMENT',
          fromStatus: fresh.status,
          toStatus: 'INSTALLED',
          fromHolder: fresh.holder,
          toHolder: 'DRIVER',
          toLocation: old.location,
          toDriverId: a.driverId,
          note: `Agreement ${a.number}, ticket ${t.number}, replaces ${old.serial}`,
          byId: actor.id,
        },
      });

      // The database lets the agreement battery change only inside a recorded
      // replacement (clause C8; migration M4).
      await tx.$queryRaw`SELECT set_config('voltneo.replacing_battery_for', ${a.id}, true)`;
      await tx.agreement.update({ where: { id: a.id }, data: { batteryId: fresh.id } });
      await tx.agreementEvent.create({
        data: {
          agreementId: a.id,
          event: 'BATTERY_REPLACED',
          fromState: a.state,
          toState: a.state,
          reason: `Ticket ${t.number}: ${old.serial} replaced with ${fresh.serial}`,
          actorType: 'STAFF',
          actorId: actor.id,
        },
      });
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        'ticket.replace_battery',
        id,
        { agreementBatteryId: old.id },
        replacement,
      );
    });
    return this.get(id, actor);
  }

  // ---------------------------------------------------------------------------
  // Resolve or cancel
  // ---------------------------------------------------------------------------

  async resolve(id: string, dto: ResolveTicketDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const messageId = await serializable(this.prisma, async (tx) => {
      const t = await this.load(id, tx);
      if (t.status !== 'ASSIGNED') {
        throw new ConflictException(
          t.status === 'OPEN'
            ? 'Assign a technician and record the visit first'
            : 'This ticket is already finished',
        );
      }
      this.checkOwnTicket(t, actor);
      if (!t.respondedAt) {
        throw new ConflictException("Record the technician's visit before resolving the ticket");
      }
      const replaced = t.replacements.length > 0;
      if (dto.outcome === 'REPLACED' && !replaced) {
        throw new ConflictException('Record the replacement battery first');
      }
      if (dto.outcome !== 'REPLACED' && replaced) {
        throw new UnprocessableEntityException(
          'The battery was replaced on this ticket: choose "Battery replaced"',
        );
      }
      const now = this.clock.now();
      const after = await tx.serviceTicket.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          outcome: dto.outcome,
          resolution: dto.resolution,
          resolvedAt: now,
          resolvedById: actor.id,
        },
      });
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        'ticket.resolve',
        id,
        { status: t.status },
        { status: after.status, outcome: after.outcome, resolution: after.resolution },
      );
      const d = t.agreement.driver;
      const lang = d.language as DriverLanguage;
      return this.messaging.queue(tx, {
        driverId: d.id,
        toPhone: d.phone,
        channel: 'SMS',
        template: 'ticket_resolved',
        language: lang,
        body: TEXTS[lang].ticketResolvedSms({ ticket: t.number }),
        agreementId: t.agreementId,
      });
    });
    await this.messaging.deliver([messageId]);
    return this.get(id, actor);
  }

  async cancel(id: string, dto: CancelTicketDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const t = await this.load(id, tx);
      if (t.status !== 'OPEN' && t.status !== 'ASSIGNED') {
        throw new ConflictException('This ticket is already finished');
      }
      if (t.replacements.length) {
        throw new ConflictException(
          'The battery was replaced on this ticket: resolve it instead of cancelling',
        );
      }
      const after = await tx.serviceTicket.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: this.clock.now(), cancelReason: dto.reason },
      });
      await this.record(
        tx,
        { id: actor.id, ip: meta.ip, requestId: meta.requestId },
        'ticket.cancel',
        id,
        { status: t.status },
        { status: after.status, cancelReason: after.cancelReason },
      );
    });
    return this.get(id, actor);
  }

  async photoLink(ticketId: string, photoId: string) {
    const photo = await this.prisma.ticketPhoto.findUnique({
      where: { id: photoId },
      include: { visit: { select: { ticketId: true } } },
    });
    if (!photo || photo.visit.ticketId !== ticketId) throw new NotFoundException('Photo not found');
    return this.links.issue(photo.fileKey, photo.fileType, photo.fileName);
  }

  /** Every visit on a battery, newest first: its service history (no BMS, B9). */
  async batteryHistory(batteryId: string) {
    const visits = await this.prisma.ticketVisit.findMany({
      where: { batteryId },
      include: { ticket: { select: { id: true, number: true, category: true } } },
      orderBy: { visitedAt: 'desc' },
      take: 100,
    });
    const names = await this.names(visits.map((v) => v.technicianId));
    return visits.map((v) => ({
      id: v.id,
      visitedAt: v.visitedAt,
      ticket: v.ticket,
      technicianName: names.get(v.technicianId) ?? null,
      voltageReading: v.voltageReading?.toString() ?? null,
      readingsNote: v.readingsNote,
      finding: v.finding,
    }));
  }
}
