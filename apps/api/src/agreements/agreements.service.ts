import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AGREEMENT_DOCUMENT_VERSION,
  PAYABLE_STATES,
  addMonths,
  agreementNumber,
  buildSchedule,
  canTransition,
  firstDueDateProblem,
  hasPermission,
  installationDateProblem,
  isDueDay,
  type AgreementState,
  type DueDay,
  RELATIVE_RELATION_LABELS,
} from '@voltneo/shared';
import type { Agreement, ApprovalRequest, Prisma } from '../generated/prisma/client';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DriversService, type UploadedFile } from '../drivers/drivers.service';
import {
  DocumentsService,
  type AgreementDocData,
  type ScheduleDoc,
} from '../documents/documents.service';
import {
  FILE_STORAGE,
  FileLinks,
  checkUpload,
  newFileKey,
  type FileStorage,
} from '../files/file-storage';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { nextCounter } from '../common/counters';
import { assembleSignedCopy } from './signed-copy';
import {
  dateOnly,
  istDate,
  isUniqueViolation,
  parseDateOnly,
  serializable,
  type Tx,
} from '../common/util';
import type {
  CancelAgreementDto,
  CreateAgreementDto,
  InstallationDto,
  ListAgreementsQuery,
  RescheduleDto,
  SignAgreementDto,
  UpdateAgreementDto,
} from './dto';

const MAX_PHOTOS = 6;
/** Times typed into forms are to the minute, so ordering checks allow one minute. */
const MINUTE = 60_000;

/** Identity documents in the order the printed agreement prefers them. */
const ID_PREFERENCE = [
  'AADHAAR',
  'VOTER_ID',
  'DRIVING_LICENCE',
  'PASSPORT',
  'PAN',
  'RATION_CARD',
  'OTHER_ID',
] as const;
const ID_LABELS: Record<(typeof ID_PREFERENCE)[number], string> = {
  AADHAAR: 'Aadhaar',
  VOTER_ID: 'Voter ID (EPIC)',
  DRIVING_LICENCE: 'Driving Licence',
  PASSPORT: 'Passport',
  PAN: 'PAN',
  RATION_CARD: 'Ration Card',
  OTHER_ID: 'ID document',
};
const VEHICLE_LABELS: Record<'TOTO' | 'E_RICKSHAW' | 'E_THREE_WHEELER', string> = {
  TOTO: 'Toto',
  E_RICKSHAW: 'E-rickshaw',
  E_THREE_WHEELER: 'E-three-wheeler',
};

/** Whole years between a date of birth and a date (both YYYY-MM-DD). */
export function ageOn(dob: string, on: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = on.split('-').map(Number) as [number, number, number];
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

const fullInclude = {
  driver: true,
  vehicle: true,
  planVersion: { include: { plan: true } },
  batteryType: true,
  battery: true,
  instalments: { orderBy: { sequence: 'asc' } },
  lateFees: { orderBy: { accrualDate: 'asc' } },
  events: { orderBy: { at: 'asc' } },
  installations: { include: { photos: true }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.AgreementInclude;

type AgreementFull = Prisma.AgreementGetPayload<{ include: typeof fullInclude }>;

function openConflict(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new ConflictException(
      'This driver, vehicle or battery already has an open agreement. Finish or cancel it first.',
    );
  }
  throw err;
}

@Injectable()
export class AgreementsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly drivers: DriversService,
    private readonly documents: DocumentsService,
    private readonly links: FileLinks,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  onModuleInit() {
    // A signed agreement changes only through a head-office variation approved
    // by a second person (clause A6, D26). M2 supports moving the first due
    // date before installation; other variations follow with collections.
    this.approvals.register('VARIATION', {
      onApprove: async (tx, request, approver) => {
        const payload = request.payload as { kind?: string; firstDueDate?: string } | null;
        if (payload?.kind !== 'FIRST_DUE_DATE' || !payload.firstDueDate) {
          throw new BadRequestException('This variation type is not supported yet');
        }
        await this.applyNewFirstDueDate(tx, request, payload.firstDueDate, approver);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  private async staffNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return new Map();
    const rows = await this.prisma.staffUser.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private lines(a: Agreement & { instalments: AgreementFull['instalments'] }) {
    if (a.instalments.length) {
      return a.instalments.map((i) => ({
        id: i.id,
        sequence: i.sequence,
        dueDate: dateOnly(i.dueDate),
        amount: i.amount,
        amountPaid: i.amountPaid,
        status: i.status,
        paidAt: i.paidAt,
      }));
    }
    // Drafts have no rows yet: show the schedule they would get.
    return buildSchedule({
      downPayment: a.downPayment,
      instalment: a.instalment,
      termMonths: a.termMonths,
      firstDueDate: dateOnly(a.firstDueDate)!,
    })
      .lines.filter((l) => l.amount > 0)
      .map((l) => ({
        id: null,
        sequence: l.sequence,
        dueDate: l.dueDate,
        amount: l.amount,
        amountPaid: 0,
        status: 'UNPAID' as const,
        paidAt: null,
      }));
  }

  private money(a: AgreementFull) {
    const lines = this.lines(a);
    const paid = lines.reduce((s, l) => s + l.amountPaid, 0);
    const lateFeesDue = a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
    const next = lines.find((l) => l.status !== 'PAID');
    return {
      paid,
      outstanding: a.totalPayable - paid,
      lateFeesDue,
      nextDue: next
        ? {
            sequence: next.sequence,
            dueDate: next.dueDate,
            amountLeft: next.amount - next.amountPaid,
          }
        : null,
      instalmentsPaid: lines.filter((l) => l.sequence > 0 && l.status === 'PAID').length,
    };
  }

  private allowed(a: Agreement, hasPayments: boolean) {
    return {
      edit: a.state === 'DRAFT',
      sign: a.state === 'DRAFT',
      cancel: a.state === 'DRAFT' || (a.state === 'AWAITING_DOWN_PAYMENT' && !hasPayments),
      reschedule: a.state === 'AWAITING_DOWN_PAYMENT' || a.state === 'AWAITING_INSTALLATION',
      install: a.state === 'AWAITING_INSTALLATION',
      pay: (PAYABLE_STATES as readonly string[]).includes(a.state),
    };
  }

  async list(q: ListAgreementsQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const s = q.search?.trim();
    const digits = s?.replace(/\D/g, '');
    const where: Prisma.AgreementWhereInput = {
      state: q.state,
      driverId: q.driverId,
      OR: s
        ? [
            { number: { contains: s, mode: 'insensitive' } },
            { driver: { name: { contains: s, mode: 'insensitive' } } },
            ...(digits && digits.length >= 3 ? [{ driver: { phone: { contains: digits } } }] : []),
            { battery: { serial: { contains: s.toUpperCase() } } },
          ]
        : undefined,
    };
    const [total, rows] = await Promise.all([
      this.prisma.agreement.count({ where }),
      this.prisma.agreement.findMany({
        where,
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          planVersion: {
            select: { version: true, plan: { select: { code: true, nameEn: true } } },
          },
          batteryType: { select: { name: true } },
          battery: { select: { serial: true } },
          instalments: { select: { amountPaid: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      total,
      page,
      limit,
      items: rows.map((a) => {
        const paid = a.instalments.reduce((sum, i) => sum + i.amountPaid, 0);
        return {
          id: a.id,
          number: a.number,
          state: a.state,
          driver: a.driver,
          plan: `${a.planVersion.plan.code} v${a.planVersion.version}`,
          planName: a.planVersion.plan.nameEn,
          batteryType: a.batteryType.name,
          batterySerial: a.battery?.serial ?? null,
          totalPayable: a.totalPayable,
          paid,
          outstanding: a.totalPayable - paid,
          dueDay: a.dueDay,
          firstDueDate: dateOnly(a.firstDueDate),
          createdAt: a.createdAt,
        };
      }),
    };
  }

  private async loadFull(id: string, tx: Tx | PrismaService = this.prisma) {
    const a = await tx.agreement.findUnique({ where: { id }, include: fullInclude });
    if (!a) throw new NotFoundException('Agreement not found');
    return a;
  }

  async get(id: string) {
    const a = await this.loadFull(id);
    const installation = a.installations[0] ?? null;
    const [names, paymentCount, pendingVariation, driverFull] = await Promise.all([
      this.staffNames([
        a.createdById,
        a.explainedById,
        a.signRecordedById,
        ...a.events.map((e) => e.actorId),
        installation?.technicianId,
        installation?.recordedById,
      ]),
      this.prisma.payment.count({ where: { agreementId: id } }),
      this.prisma.approvalRequest.findFirst({
        where: { type: 'VARIATION', targetTable: 'agreements', targetId: id, status: 'PENDING' },
      }),
      a.state === 'DRAFT'
        ? this.prisma.driver.findUnique({
            where: { id: a.driverId },
            include: this.drivers.fullInclude,
          })
        : null,
    ]);
    const firstDue = dateOnly(a.firstDueDate)!;
    const plan = a.planVersion.plan;
    return {
      id: a.id,
      number: a.number,
      state: a.state,
      driver: {
        id: a.driver.id,
        name: a.driver.name,
        phone: a.driver.phone,
        language: a.driver.language,
      },
      vehicle: {
        id: a.vehicle.id,
        registration: a.vehicle.registration,
        chassisNumber: a.vehicle.chassisNumber,
        type: a.vehicle.type,
        ownedByDriver: a.vehicle.ownedByDriver,
        isCurrent: a.vehicle.isCurrent,
      },
      plan: {
        id: plan.id,
        code: plan.code,
        planVersionId: a.planVersionId,
        version: a.planVersion.version,
        versionStatus: a.planVersion.status,
        names: {
          BN: a.planVersion.nameBn ?? plan.nameBn,
          HI: a.planVersion.nameHi ?? plan.nameHi,
          EN: a.planVersion.nameEn ?? plan.nameEn,
        },
      },
      batteryType: {
        id: a.batteryType.id,
        name: a.batteryType.name,
        voltage: a.batteryType.voltage.toString(),
        capacityAh: a.batteryType.capacityAh.toString(),
      },
      battery: a.battery
        ? { id: a.battery.id, serial: a.battery.serial, gpsDeviceId: a.battery.gpsDeviceId }
        : null,
      terms: {
        downPayment: a.downPayment,
        instalment: a.instalment,
        termMonths: a.termMonths,
        totalPayable: a.totalPayable,
        dueDay: a.dueDay,
        firstDueDate: firstDue,
        lastDueDate: addMonths(firstDue, a.termMonths - 1),
        graceDays: a.graceDays,
        lateFeePerDayPaise: a.lateFeePerDayPaise,
        lateFeeCapDays: a.lateFeeCapDays,
      },
      language: a.language,
      documentVersion: a.documentVersion,
      scheduleRevision: a.scheduleRevision,
      signed: a.signedAt
        ? {
            signedAt: a.signedAt,
            method: a.signatureMethod,
            fileName: a.signedFileName,
            explainedInLanguage: a.explainedInLanguage,
            explainedByName: names.get(a.explainedById ?? '') ?? null,
            recordedByName: names.get(a.signRecordedById ?? '') ?? null,
            stamp: a.stampPaperNumber
              ? {
                  number: a.stampPaperNumber,
                  value: a.stampValue,
                  purchasedOn: dateOnly(a.stampPurchasedOn),
                }
              : null,
          }
        : null,
      activatedAt: a.activatedAt,
      completedAt: a.completedAt,
      cancelledAt: a.cancelledAt,
      cancelReason: a.cancelReason,
      notes: a.notes,
      createdAt: a.createdAt,
      createdByName: names.get(a.createdById ?? '') ?? null,
      money: this.money(a),
      schedule: this.lines(a),
      lateFees: a.lateFees.map((f) => ({
        id: f.id,
        date: dateOnly(f.accrualDate),
        amount: f.amount,
        amountPaid: f.amountPaid,
      })),
      events: a.events.map((e) => ({
        id: e.id,
        event: e.event,
        fromState: e.fromState,
        toState: e.toState,
        reason: e.reason,
        actorType: e.actorType,
        actorName: e.actorId ? (names.get(e.actorId) ?? null) : null,
        at: e.at,
      })),
      installation: installation
        ? {
            id: installation.id,
            installedAt: installation.installedAt,
            location: installation.location,
            voltageReading: installation.voltageReading.toString(),
            readingsNote: installation.readingsNote,
            conditionNote: installation.conditionNote,
            driverConfirmed: installation.driverConfirmed,
            technicianName: names.get(installation.technicianId) ?? null,
            recordedByName: names.get(installation.recordedById) ?? null,
            photos: installation.photos.map((p) => ({ id: p.id, fileName: p.fileName })),
          }
        : null,
      readiness: driverFull ? this.drivers.readinessOf(driverFull) : null,
      pendingVariation: pendingVariation
        ? {
            id: pendingVariation.id,
            summary: pendingVariation.summary,
            payload: pendingVariation.payload,
            requestedById: pendingVariation.requestedById,
          }
        : null,
      allowed: this.allowed(a, paymentCount > 0),
    };
  }

  /** Published plan versions and their prices, for the new-agreement form. */
  async options() {
    const versions = await this.prisma.planVersion.findMany({
      where: { status: 'PUBLISHED', plan: { status: 'ACTIVE' } },
      include: {
        plan: true,
        prices: { include: { batteryType: true } },
      },
      orderBy: [{ plan: { seq: 'asc' } }, { version: 'desc' }],
    });
    return versions.map((v) => ({
      planVersionId: v.id,
      planId: v.planId,
      planCode: v.plan.code,
      version: v.version,
      names: {
        BN: v.nameBn ?? v.plan.nameBn,
        HI: v.nameHi ?? v.plan.nameHi,
        EN: v.nameEn ?? v.plan.nameEn,
      },
      termMonths: v.termMonths,
      graceDays: v.graceDays,
      lateFeePerDayPaise: v.lateFeePerDayPaise,
      lateFeeCapDays: v.lateFeeCapDays,
      prices: v.prices
        .filter((p) => p.batteryType.status === 'ACTIVE')
        .map((p) => ({
          batteryTypeId: p.batteryTypeId,
          batteryTypeName: p.batteryType.name,
          compatibleVehicles: p.batteryType.compatibleVehicles,
          downPayment: p.downPayment,
          instalment: p.instalment,
          totalPayable: p.totalPayable,
        })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------------

  /** Figures copied from the plan version's price grid (T16) for the chosen battery type. */
  private async terms(
    tx: Tx,
    input: { planVersionId: string; batteryTypeId: string; vehicleType: string },
  ) {
    const version = await tx.planVersion.findUnique({
      where: { id: input.planVersionId },
      include: { plan: true, prices: { where: { batteryTypeId: input.batteryTypeId } } },
    });
    if (!version) throw new NotFoundException('Plan version not found');
    if (version.status !== 'PUBLISHED' || version.plan.status !== 'ACTIVE') {
      throw new UnprocessableEntityException(
        'Only the current published version of an active plan can be used for a new agreement',
      );
    }
    const price = version.prices[0];
    if (!price) {
      throw new UnprocessableEntityException(
        'This plan version has no price for that battery type',
      );
    }
    if (!version.termMonths) throw new UnprocessableEntityException('This plan has no term set');
    const type = await tx.batteryType.findUnique({ where: { id: input.batteryTypeId } });
    if (!type || type.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('That battery type is archived');
    }
    if (!type.compatibleVehicles.includes(input.vehicleType as never)) {
      throw new UnprocessableEntityException(
        "That battery type does not fit the driver's vehicle type",
      );
    }
    return {
      planVersionId: version.id,
      batteryTypeId: type.id,
      downPayment: price.downPayment,
      instalment: price.instalment,
      termMonths: version.termMonths,
      totalPayable: price.totalPayable,
      graceDays: version.graceDays,
      lateFeePerDayPaise: version.lateFeePerDayPaise,
      lateFeeCapDays: version.lateFeeCapDays,
    };
  }

  private async currentVehicle(tx: Tx, driverId: string) {
    const v = await tx.vehicle.findFirst({ where: { driverId, isCurrent: true } });
    if (!v) throw new UnprocessableEntityException("Record the driver's vehicle first");
    return v;
  }

  private checkFirstDue(firstDueDate: string, dueDay: number) {
    if (!isDueDay(dueDay)) throw new BadRequestException('The due day must be the 2nd or the 17th');
    const problem = firstDueDateProblem(firstDueDate, dueDay as DueDay, istDate());
    if (problem) throw new UnprocessableEntityException(problem);
  }

  private async event(
    tx: Tx,
    agreementId: string,
    e: { event: string; from: AgreementState | null; to: AgreementState; reason?: string | null },
    actorId: string | null,
  ) {
    await tx.agreementEvent.create({
      data: {
        agreementId,
        event: e.event,
        fromState: e.from,
        toState: e.to,
        reason: e.reason ?? null,
        actorType: actorId ? 'STAFF' : 'SYSTEM',
        actorId,
      },
    });
  }

  async create(dto: CreateAgreementDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    this.checkFirstDue(dto.firstDueDate, dto.dueDay);
    const id = await serializable(this.prisma, async (tx) => {
      const driver = await tx.driver.findUnique({ where: { id: dto.driverId } });
      if (!driver) throw new NotFoundException('Driver not found');
      if (driver.status !== 'ACTIVE') {
        throw new UnprocessableEntityException('This driver is marked inactive');
      }
      const vehicle = await this.currentVehicle(tx, driver.id);
      const terms = await this.terms(tx, { ...dto, vehicleType: vehicle.type });
      const seq = await nextCounter(tx, 'agreement');
      let a: Agreement;
      try {
        a = await tx.agreement.create({
          data: {
            number: agreementNumber(seq),
            driverId: driver.id,
            vehicleId: vehicle.id,
            ...terms,
            dueDay: dto.dueDay,
            firstDueDate: parseDateOnly(dto.firstDueDate),
            language: driver.language,
            documentVersion: AGREEMENT_DOCUMENT_VERSION,
            notes: dto.notes ?? null,
            createdById: actor.id,
          },
        });
      } catch (err) {
        openConflict(err);
      }
      await this.event(tx, a.id, { event: 'CREATED', from: null, to: 'DRAFT' }, actor.id);
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.create',
          tableName: 'agreements',
          recordId: a.id,
          after: a,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return a.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateAgreementDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const before = await tx.agreement.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Agreement not found');
      if (before.state !== 'DRAFT') {
        throw new ConflictException(
          'Only a draft can be edited; a signed agreement needs a variation',
        );
      }
      const dueDay = dto.dueDay ?? before.dueDay;
      const firstDueDate = dto.firstDueDate ?? dateOnly(before.firstDueDate)!;
      this.checkFirstDue(firstDueDate, dueDay);
      // A draft always follows the driver's current vehicle and current prices.
      const vehicle = await this.currentVehicle(tx, before.driverId);
      const terms = await this.terms(tx, {
        planVersionId: dto.planVersionId ?? before.planVersionId,
        batteryTypeId: dto.batteryTypeId ?? before.batteryTypeId,
        vehicleType: vehicle.type,
      });
      let after: Agreement;
      try {
        after = await tx.agreement.update({
          where: { id },
          data: {
            ...terms,
            vehicleId: vehicle.id,
            dueDay,
            firstDueDate: parseDateOnly(firstDueDate),
            notes: dto.notes === undefined ? before.notes : dto.notes,
          },
        });
      } catch (err) {
        openConflict(err);
      }
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.update',
          tableName: 'agreements',
          recordId: id,
          before,
          after,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async cancel(id: string, dto: CancelAgreementDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const before = await tx.agreement.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Agreement not found');
      const payments = await tx.payment.count({ where: { agreementId: id } });
      if (!canTransition(before.state, 'CANCELLED') || payments > 0) {
        throw new ConflictException(
          'Only a draft, or a signed agreement before any money is received, can be cancelled',
        );
      }
      const after = await tx.agreement.update({
        where: { id },
        data: { state: 'CANCELLED', cancelledAt: new Date(), cancelReason: dto.reason },
      });
      await this.event(
        tx,
        id,
        { event: 'CANCELLED', from: before.state, to: 'CANCELLED', reason: dto.reason },
        actor.id,
      );
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.cancel',
          tableName: 'agreements',
          recordId: id,
          before,
          after,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------------

  async sign(
    id: string,
    dto: SignAgreementDto,
    files: UploadedFile[] | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const signedAt = new Date(dto.signedAt);
    if (signedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('The signing time cannot be in the future');
    }
    if (dto.stampPurchasedOn > istDate(signedAt)) {
      throw new BadRequestException('The stamp paper must be bought on or before the signing date');
    }
    const number = (
      await this.prisma.agreement.findUnique({ where: { id }, select: { number: true } })
    )?.number;
    if (!number) throw new NotFoundException('Agreement not found');
    const copy = await assembleSignedCopy(files, number);
    const key = newFileKey('agreements', id, 'pdf');
    let stored = false;

    await serializable(this.prisma, async (tx) => {
      const before = await tx.agreement.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Agreement not found');
      if (before.state !== 'DRAFT') throw new ConflictException('This agreement is already signed');
      if (signedAt.getTime() < before.createdAt.getTime() - MINUTE) {
        throw new BadRequestException('The signing time is before the agreement was prepared');
      }

      // Readiness checklist (T25) must be complete at signing.
      const driver = await tx.driver.findUnique({
        where: { id: before.driverId },
        include: this.drivers.fullInclude,
      });
      const ready = this.drivers.readinessOf(driver!);
      if (!ready.ready) {
        throw new UnprocessableEntityException({
          message: 'The driver is not ready for an agreement yet',
          code: 'NOT_READY',
          readiness: ready,
        });
      }
      const vehicle = await this.currentVehicle(tx, before.driverId);
      if (vehicle.id !== before.vehicleId) {
        throw new ConflictException(
          "The driver's vehicle changed after this draft was made. Save the draft again first.",
        );
      }
      const version = await tx.planVersion.findUnique({
        where: { id: before.planVersionId },
        include: { plan: true },
      });
      if (version?.status !== 'PUBLISHED' || version.plan.status !== 'ACTIVE') {
        throw new ConflictException(
          'This plan version is no longer offered. Choose the current version in the draft first.',
        );
      }
      const firstDue = dateOnly(before.firstDueDate)!;
      this.checkFirstDue(firstDue, before.dueDay);

      const explainer = await tx.staffUser.findUnique({
        where: { id: dto.explainedById ?? actor.id },
      });
      if (!explainer || explainer.status !== 'ACTIVE') {
        throw new BadRequestException('The staff member who explained it must be an active user');
      }

      if (!stored) {
        await this.storage.put(key, copy.buffer, 'application/pdf');
        stored = true;
      }

      const schedule = buildSchedule({
        downPayment: before.downPayment,
        instalment: before.instalment,
        termMonths: before.termMonths,
        firstDueDate: firstDue,
      });
      await tx.instalment.createMany({
        data: schedule.lines
          .filter((l) => l.amount > 0)
          .map((l) => ({
            agreementId: id,
            sequence: l.sequence,
            dueDate: l.dueDate ? parseDateOnly(l.dueDate) : null,
            amount: l.amount,
          })),
      });

      const to: AgreementState =
        before.downPayment > 0 ? 'AWAITING_DOWN_PAYMENT' : 'AWAITING_INSTALLATION';
      const after = await tx.agreement.update({
        where: { id },
        data: {
          state: to,
          signedAt,
          signatureMethod: 'PAPER',
          signedFileKey: key,
          signedFileName: copy.name,
          signedFileType: 'application/pdf',
          stampPaperNumber: dto.stampPaperNumber,
          stampValue: dto.stampValueRupees * 100,
          stampPurchasedOn: parseDateOnly(dto.stampPurchasedOn),
          explainedInLanguage: dto.explainedInLanguage,
          explainedById: explainer.id,
          signRecordedById: actor.id,
        },
      });
      await this.event(
        tx,
        id,
        {
          event: 'SIGNED',
          from: 'DRAFT',
          to,
          reason: before.downPayment > 0 ? null : 'No down payment on this plan',
        },
        actor.id,
      );
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.sign',
          tableName: 'agreements',
          recordId: id,
          before,
          after,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async signedCopyLink(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const a = await this.prisma.agreement.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!a.signedFileKey) throw new NotFoundException('No signed copy has been uploaded');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: actor.id,
      action: 'agreement.signed_copy.view',
      tableName: 'agreements',
      recordId: id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.links.issue(
      a.signedFileKey,
      a.signedFileType ?? 'application/octet-stream',
      a.signedFileName ?? 'signed-agreement',
    );
  }

  // ---------------------------------------------------------------------------
  // Moving the first due date (variation, maker-checker)
  // ---------------------------------------------------------------------------

  async requestReschedule(
    id: string,
    dto: RescheduleDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    return serializable(this.prisma, async (tx) => {
      const a = await tx.agreement.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Agreement not found');
      if (a.state !== 'AWAITING_DOWN_PAYMENT' && a.state !== 'AWAITING_INSTALLATION') {
        throw new ConflictException(
          'The first due date can only be moved after signing and before installation',
        );
      }
      const current = dateOnly(a.firstDueDate)!;
      if (dto.firstDueDate === current) {
        throw new BadRequestException('That is already the first due date');
      }
      this.checkFirstDue(dto.firstDueDate, a.dueDay);
      return this.approvals.create(
        tx,
        {
          type: 'VARIATION',
          targetTable: 'agreements',
          targetId: id,
          summary: `Move first due date of ${a.number} from ${current} to ${dto.firstDueDate}`,
          reason: dto.reason,
          payload: {
            kind: 'FIRST_DUE_DATE',
            agreementNumber: a.number,
            firstDueDate: dto.firstDueDate,
            previous: current,
          },
        },
        actor,
        meta,
      );
    });
  }

  private async applyNewFirstDueDate(
    tx: Tx,
    request: ApprovalRequest,
    firstDueDate: string,
    approver: AuthenticatedStaff,
  ) {
    const before = await tx.agreement.findUnique({
      where: { id: request.targetId },
      include: { instalments: { orderBy: { sequence: 'asc' } } },
    });
    if (!before) throw new NotFoundException('Agreement not found');
    if (before.state !== 'AWAITING_DOWN_PAYMENT' && before.state !== 'AWAITING_INSTALLATION') {
      throw new ConflictException('The agreement has moved on; this change no longer applies');
    }
    this.checkFirstDue(firstDueDate, before.dueDay);
    for (const i of before.instalments) {
      if (i.sequence === 0) continue;
      if (i.amountPaid > 0) throw new ConflictException('An instalment has already been paid');
      await tx.instalment.update({
        where: { id: i.id },
        data: { dueDate: parseDateOnly(addMonths(firstDueDate, i.sequence - 1)) },
      });
    }
    const after = await tx.agreement.update({
      where: { id: before.id },
      data: {
        firstDueDate: parseDateOnly(firstDueDate),
        scheduleRevision: before.scheduleRevision + 1,
      },
    });
    await this.event(
      tx,
      before.id,
      {
        event: 'FIRST_DUE_DATE_MOVED',
        from: before.state,
        to: before.state,
        reason: `${dateOnly(before.firstDueDate)} → ${firstDueDate}: ${request.reason}`,
      },
      approver.id,
    );
    const { instalments: _i, ...beforeRow } = before;
    await this.audit.record(
      {
        actorType: 'STAFF',
        actorId: approver.id,
        action: 'agreement.reschedule',
        tableName: 'agreements',
        recordId: before.id,
        before: beforeRow,
        after,
        ip: null,
        requestId: null,
      },
      tx,
    );
  }

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  private docData(a: AgreementFull): AgreementDocData {
    const firstDue = dateOnly(a.firstDueDate)!;
    const plan = a.planVersion.plan;
    return {
      number: a.number,
      signed: a.state !== 'DRAFT',
      documentVersion: a.documentVersion,
      scheduleRevision: a.scheduleRevision,
      driver: { name: a.driver.name, phone: a.driver.phone },
      vehicle: {
        identifier: a.vehicle.registration ?? `Chassis ${a.vehicle.chassisNumber ?? ''}`.trim(),
      },
      plan: {
        code: plan.code,
        version: a.planVersion.version,
        names: {
          BN: a.planVersion.nameBn ?? plan.nameBn,
          HI: a.planVersion.nameHi ?? plan.nameHi,
          EN: a.planVersion.nameEn ?? plan.nameEn,
        },
      },
      batteryType: {
        name: a.batteryType.name,
        voltage: a.batteryType.voltage.toString(),
        capacityAh: a.batteryType.capacityAh.toString(),
      },
      downPayment: a.downPayment,
      instalment: a.instalment,
      termMonths: a.termMonths,
      totalPayable: a.totalPayable,
      dueDay: a.dueDay,
      firstDueDate: firstDue,
      lastDueDate: addMonths(firstDue, a.termMonths - 1),
      graceDays: a.graceDays,
      lateFeePerDayPaise: a.lateFeePerDayPaise,
      lateFeeCapDays: a.lateFeeCapDays,
      nominee: {
        name: a.driver.nomineeName,
        relation: a.driver.nomineeRelation,
        phone: a.driver.nomineePhone,
      },
      lines: this.lines(a).map((l) => ({
        sequence: l.sequence,
        dueDate: l.dueDate,
        amount: l.amount,
      })),
    };
  }

  /** The whole agreement for printing on stamp paper (English, founder 31 Oct 2026). */
  async agreementDocument(id: string) {
    const a = await this.loadFull(id);
    if (a.state === 'CANCELLED') throw new ConflictException('This agreement was cancelled');
    const ids = await this.prisma.kycDocument.findMany({
      where: { driverId: a.driverId, status: 'VERIFIED', numberLast4: { not: null } },
      select: { type: true, numberLast4: true },
    });
    const id0 = ID_PREFERENCE.map((t) => ids.find((d) => d.type === t)).find(Boolean);
    const d = a.driver;
    const today = istDate(new Date());
    const dob = dateOnly(d.dateOfBirth);
    const pdf = await this.documents.agreement({
      ...this.docData(a),
      party: {
        name: d.name,
        age: dob ? ageOn(dob, today) : null,
        relative:
          d.relativeRelation && d.relativeName
            ? { relation: RELATIVE_RELATION_LABELS[d.relativeRelation], name: d.relativeName }
            : null,
        address: [d.addressLine, d.area, d.district, `${d.state} ${d.pinCode}`]
          .filter(Boolean)
          .join(', '),
        phone: d.phone,
        id: id0
          ? {
              label: ID_LABELS[id0.type as (typeof ID_PREFERENCE)[number]],
              last4: id0.numberLast4!,
            }
          : null,
      },
      vehicleDetail: {
        type: VEHICLE_LABELS[a.vehicle.type],
        registration: a.vehicle.registration,
        chassis: a.vehicle.chassisNumber,
        ownedByDriver: a.vehicle.ownedByDriver,
        ownerName: a.vehicle.ownerName,
        ownerPhone: a.vehicle.ownerPhone,
      },
      batteryDetail: { chemistry: a.batteryType.chemistry, serial: a.battery?.serial ?? null },
      driverLanguage: a.language,
    });
    return { pdf, fileName: `${a.number}-agreement.pdf` };
  }

  async document(id: string, doc: ScheduleDoc, lang: DriverLanguage | undefined) {
    const a = await this.loadFull(id);
    if (a.state === 'CANCELLED') throw new ConflictException('This agreement was cancelled');
    const language = lang ?? a.language;
    const pdf = await this.documents.schedule(doc, this.docData(a), language);
    return {
      pdf,
      fileName: `${a.number}-${doc}-${language.toLowerCase()}.pdf`,
    };
  }

  // ---------------------------------------------------------------------------
  // Installation (spec module 7, Schedule 3)
  // ---------------------------------------------------------------------------

  async recordInstallation(
    id: string,
    dto: InstallationDto,
    files: UploadedFile[] | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const photos = (files ?? []).map((f) => ({ file: f, upload: checkUpload(f) }));
    if (!photos.length) throw new BadRequestException('Attach at least one installation photo');
    if (photos.length > MAX_PHOTOS) {
      throw new BadRequestException(`Attach at most ${MAX_PHOTOS} photos`);
    }
    if (photos.some((p) => p.upload.ext === 'pdf')) {
      throw new BadRequestException('Installation photos must be JPEG, PNG or WebP images');
    }
    const installedAt = new Date(dto.installedAt);
    if (installedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('The installation time cannot be in the future');
    }
    const keys = photos.map((p) => newFileKey('installations', id, p.upload.ext));
    let stored = false;

    await serializable(this.prisma, async (tx) => {
      const before = await tx.agreement.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Agreement not found');
      if (before.state !== 'AWAITING_INSTALLATION') {
        throw new ConflictException(
          before.state === 'AWAITING_DOWN_PAYMENT'
            ? 'The down payment must be received before installation (clause C2)'
            : 'This agreement is not waiting for installation',
        );
      }
      if (before.signedAt && installedAt.getTime() < before.signedAt.getTime() - MINUTE) {
        throw new BadRequestException('Installation cannot be before the agreement was signed');
      }
      const problem = installationDateProblem(istDate(installedAt), dateOnly(before.firstDueDate)!);
      if (problem) throw new UnprocessableEntityException(problem);

      const vehicle = await this.currentVehicle(tx, before.driverId);
      if (vehicle.id !== before.vehicleId) {
        throw new ConflictException(
          "The driver's vehicle changed after signing. Changing vehicle needs head office (clause C5).",
        );
      }
      const battery = await tx.battery.findUnique({ where: { id: dto.batteryId } });
      if (!battery) throw new NotFoundException('Battery not found');
      if (battery.status !== 'IN_STOCK') {
        throw new ConflictException(`Battery ${battery.serial} is not in stock`);
      }
      if (battery.batteryTypeId !== before.batteryTypeId) {
        throw new UnprocessableEntityException(
          `Battery ${battery.serial} is not the battery type in this agreement`,
        );
      }
      if (!battery.gpsDeviceId) {
        throw new UnprocessableEntityException(
          `Battery ${battery.serial} has no GPS device recorded (D13)`,
        );
      }
      const technician = await tx.staffUser.findUnique({ where: { id: dto.technicianId } });
      if (
        !technician ||
        technician.status !== 'ACTIVE' ||
        !hasPermission(technician.role, 'installations.record')
      ) {
        throw new BadRequestException('Choose an active technician who may install batteries');
      }

      if (!stored) {
        for (let i = 0; i < photos.length; i++) {
          await this.storage.put(keys[i]!, photos[i]!.file.buffer, photos[i]!.upload.mime);
        }
        stored = true;
      }

      const installation = await tx.installation.create({
        data: {
          agreementId: id,
          batteryId: battery.id,
          vehicleId: vehicle.id,
          technicianId: technician.id,
          installedAt,
          location: dto.location,
          voltageReading: dto.voltageReading,
          readingsNote: dto.readingsNote ?? null,
          conditionNote: dto.conditionNote,
          driverConfirmed: true,
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

      // The battery is now with the driver (custody log, spec rule 17).
      const where = vehicle.registration ?? vehicle.chassisNumber ?? null;
      await tx.battery.update({
        where: { id: battery.id },
        data: {
          status: 'INSTALLED',
          holder: 'DRIVER',
          holderDriverId: before.driverId,
          holderStaffId: null,
          location: where ? `Vehicle ${where}` : null,
        },
      });
      await tx.batteryCustody.create({
        data: {
          batteryId: battery.id,
          event: 'INSTALLED',
          fromStatus: battery.status,
          toStatus: 'INSTALLED',
          fromHolder: battery.holder,
          toHolder: 'DRIVER',
          toLocation: where ? `Vehicle ${where}` : null,
          toDriverId: before.driverId,
          note: `Agreement ${before.number}`,
          byId: actor.id,
        },
      });

      let after: Agreement;
      try {
        after = await tx.agreement.update({
          where: { id },
          data: { state: 'ACTIVE', batteryId: battery.id, activatedAt: installedAt },
        });
      } catch (err) {
        openConflict(err);
      }
      await this.event(
        tx,
        id,
        {
          event: 'INSTALLED',
          from: before.state,
          to: 'ACTIVE',
          reason: `Battery ${battery.serial} installed`,
        },
        actor.id,
      );
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.install',
          tableName: 'agreements',
          recordId: id,
          before,
          after: { ...after, installationId: installation.id },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async installationPhotoLink(agreementId: string, photoId: string) {
    const photo = await this.prisma.installationPhoto.findUnique({
      where: { id: photoId },
      include: { installation: { select: { agreementId: true } } },
    });
    if (!photo || photo.installation.agreementId !== agreementId) {
      throw new NotFoundException('Photo not found');
    }
    return this.links.issue(photo.fileKey, photo.fileType, photo.fileName);
  }
}
