import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KYC_DOC_INFO,
  MIN_DRIVER_AGE,
  ageOn,
  docNumberProblem,
  maskDocNumber,
  normaliseIndianMobile,
  normaliseRegistration,
  readiness,
  type KycDocType,
} from '@voltneo/shared';
import type { Driver, KycDocument, Prisma, Vehicle } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KycCryptoService } from '../kyc/kyc-crypto.service';
import {
  FILE_STORAGE,
  FileLinks,
  checkUpload,
  newFileKey,
  type FileStorage,
} from '../files/file-storage';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { dateOnly, istDate, parseDateOnly, serializable, type Tx } from '../common/util';
import type {
  CreateDriverDto,
  ListDriversQuery,
  RejectKycDto,
  UpdateDriverDto,
  UploadKycDto,
  VehicleDto,
} from './dto';

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

export interface Duplicate {
  kind: 'phone' | 'registration' | 'document';
  driverId: string;
  driverName: string;
  detail: string;
}

type DriverFull = Driver & { kycDocuments: KycDocument[]; vehicles: Vehicle[] };

function phone(raw: string | null | undefined, label: string): string | null {
  if (raw === null || raw === undefined) return null;
  const p = normaliseIndianMobile(raw);
  if (!p) throw new BadRequestException(`${label} must be a 10-digit Indian mobile number`);
  return p;
}

function checkAge(dob: string | null | undefined) {
  if (!dob) return;
  const today = istDate();
  if (dob > today) throw new BadRequestException('Date of birth cannot be in the future');
  if (ageOn(dob, today) < MIN_DRIVER_AGE) {
    throw new BadRequestException(`The driver must be at least ${MIN_DRIVER_AGE} years old`);
  }
  if (ageOn(dob, today) > 100) throw new BadRequestException('Check the date of birth');
}

function possibleDuplicate(duplicates: Duplicate[]): ConflictException {
  return new ConflictException({
    message: 'This may be a duplicate. Check the matches, then confirm to save anyway.',
    code: 'POSSIBLE_DUPLICATE',
    duplicates,
  });
}

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: KycCryptoService,
    private readonly links: FileLinks,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private docView(d: KycDocument, names: Map<string, string>) {
    return {
      id: d.id,
      type: d.type,
      label: KYC_DOC_INFO[d.type].label,
      maskedNumber: maskDocNumber(d.type, d.numberLast4),
      fullNumberStored: !!d.numberEncrypted,
      usedForAddress: d.usedForAddress,
      fileName: d.fileName,
      fileType: d.fileType,
      fileSize: d.fileSize,
      status: d.status,
      verifiedByName: d.verifiedById ? (names.get(d.verifiedById) ?? null) : null,
      verifiedAt: d.verifiedAt,
      rejectionReason: d.rejectionReason,
      uploadedByName: d.uploadedById ? (names.get(d.uploadedById) ?? null) : null,
      createdAt: d.createdAt,
    };
  }

  private vehicleView(v: Vehicle) {
    return {
      id: v.id,
      isCurrent: v.isCurrent,
      registration: v.registration,
      chassisNumber: v.chassisNumber,
      type: v.type,
      makeModel: v.makeModel,
      ownedByDriver: v.ownedByDriver,
      ownerName: v.ownerName,
      ownerPhone: v.ownerPhone,
      ownerConsent: v.ownerConsentFileKey
        ? {
            fileName: v.ownerConsentFileName,
            fileType: v.ownerConsentFileType,
            uploadedAt: v.ownerConsentUploadedAt,
          }
        : null,
      createdAt: v.createdAt,
    };
  }

  private readinessOf(d: DriverFull) {
    const vehicle = d.vehicles.find((v) => v.isCurrent) ?? null;
    return readiness({
      dateOfBirth: dateOnly(d.dateOfBirth),
      today: istDate(),
      nomineeRecorded: !!(d.nomineeName && d.nomineeRelation && d.nomineePhone),
      documents: d.kycDocuments.map((k) => ({
        type: k.type,
        status: k.status,
        usedForAddress: k.usedForAddress,
      })),
      vehicle: vehicle
        ? {
            ownedByDriver: vehicle.ownedByDriver,
            ownerConsentUploaded: !!vehicle.ownerConsentFileKey,
          }
        : null,
    });
  }

  private driverFields(d: Driver) {
    return {
      id: d.id,
      name: d.name,
      phone: d.phone,
      altPhone: d.altPhone,
      language: d.language,
      dateOfBirth: dateOnly(d.dateOfBirth),
      addressLine: d.addressLine,
      area: d.area,
      district: d.district,
      state: d.state,
      pinCode: d.pinCode,
      status: d.status,
      nominee: { name: d.nomineeName, relation: d.nomineeRelation, phone: d.nomineePhone },
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private readonly fullInclude = {
    kycDocuments: { orderBy: { createdAt: 'desc' } },
    vehicles: { orderBy: { createdAt: 'desc' } },
  } satisfies Prisma.DriverInclude;

  async list(q: ListDriversQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const s = q.search?.trim();
    const digits = s?.replace(/\D/g, '');
    const where: Prisma.DriverWhereInput = {
      status: q.status,
      OR: s
        ? [
            { name: { contains: s, mode: 'insensitive' } },
            ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            { vehicles: { some: { registration: { contains: normaliseRegistration(s) } } } },
          ]
        : undefined,
    };
    const all = await this.prisma.driver.findMany({
      where,
      include: this.fullInclude,
      orderBy: { createdAt: 'desc' },
      take: q.readiness ? 2000 : undefined,
      skip: q.readiness ? undefined : (page - 1) * limit,
      ...(q.readiness ? {} : { take: limit }),
    });
    let rows = all.map((d) => {
      const r = this.readinessOf(d);
      const vehicle = d.vehicles.find((v) => v.isCurrent);
      return {
        id: d.id,
        name: d.name,
        phone: d.phone,
        language: d.language,
        district: d.district,
        status: d.status,
        vehicle: vehicle
          ? {
              registration: vehicle.registration,
              type: vehicle.type,
              ownedByDriver: vehicle.ownedByDriver,
            }
          : null,
        ready: r.ready,
        itemsDone: r.items.filter((i) => i.done).length,
        itemsTotal: r.items.length,
        pendingDocuments: d.kycDocuments.filter((k) => k.status === 'PENDING').length,
        createdAt: d.createdAt,
      };
    });
    let total: number;
    if (q.readiness) {
      rows = rows.filter((r) => r.ready === (q.readiness === 'ready'));
      total = rows.length;
      rows = rows.slice((page - 1) * limit, page * limit);
    } else {
      total = await this.prisma.driver.count({ where });
    }
    return { total, page, limit, items: rows };
  }

  async get(id: string) {
    const d = await this.prisma.driver.findUnique({ where: { id }, include: this.fullInclude });
    if (!d) throw new NotFoundException('Driver not found');
    const staffIds = [
      ...new Set(d.kycDocuments.flatMap((k) => [k.verifiedById, k.uploadedById]).filter(Boolean)),
    ] as string[];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    const current = d.vehicles.find((v) => v.isCurrent) ?? null;
    return {
      ...this.driverFields(d),
      vehicle: current ? this.vehicleView(current) : null,
      previousVehicles: d.vehicles.filter((v) => !v.isCurrent).map((v) => this.vehicleView(v)),
      documents: d.kycDocuments.map((k) => this.docView(k, names)),
      readiness: this.readinessOf(d),
      duplicates: await this.findDuplicates(this.prisma, {
        driverId: id,
        phones: [d.phone, d.altPhone].filter(Boolean) as string[],
        registration: current?.registration ?? null,
        chassis: current?.chassisNumber ?? null,
        docIndexes: d.kycDocuments
          .filter((k) => k.numberIndex && k.status !== 'REJECTED')
          .map((k) => ({
            index: k.numberIndex!,
            type: k.type,
          })),
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Duplicate flags (spec module 5: duplicate phone or ID is flagged)
  // ---------------------------------------------------------------------------

  private async findDuplicates(
    tx: Tx | PrismaService,
    q: {
      driverId?: string;
      phones?: string[];
      registration?: string | null;
      chassis?: string | null;
      docIndexes?: { index: string; type: KycDocType }[];
    },
  ): Promise<Duplicate[]> {
    const out: Duplicate[] = [];
    const notMe = q.driverId ? { not: q.driverId } : undefined;
    if (q.phones?.length) {
      const rows = await tx.driver.findMany({
        where: { id: notMe, OR: [{ phone: { in: q.phones } }, { altPhone: { in: q.phones } }] },
        select: { id: true, name: true, phone: true },
      });
      for (const r of rows)
        out.push({
          kind: 'phone',
          driverId: r.id,
          driverName: r.name,
          detail: `Same phone number (${r.phone})`,
        });
    }
    const vehicleOr: Prisma.VehicleWhereInput[] = [];
    if (q.registration) vehicleOr.push({ registration: q.registration });
    if (q.chassis) vehicleOr.push({ chassisNumber: q.chassis });
    if (vehicleOr.length) {
      const rows = await tx.vehicle.findMany({
        where: { isCurrent: true, driverId: notMe, OR: vehicleOr },
        include: { driver: { select: { id: true, name: true } } },
      });
      for (const r of rows) {
        out.push({
          kind: 'registration',
          driverId: r.driver.id,
          driverName: r.driver.name,
          detail: `Same vehicle (${r.registration ?? r.chassisNumber})`,
        });
      }
    }
    if (q.docIndexes?.length) {
      const rows = await tx.kycDocument.findMany({
        where: {
          driverId: notMe,
          status: { not: 'REJECTED' },
          numberIndex: { in: q.docIndexes.map((d) => d.index) },
        },
        include: { driver: { select: { id: true, name: true } } },
      });
      for (const r of rows) {
        out.push({
          kind: 'document',
          driverId: r.driver.id,
          driverName: r.driver.name,
          detail: `Same ${KYC_DOC_INFO[r.type].label} (${maskDocNumber(r.type, r.numberLast4)})`,
        });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Drivers
  // ---------------------------------------------------------------------------

  private vehicleData(v: VehicleDto) {
    const registration = v.registration ? normaliseRegistration(v.registration) : null;
    const chassisNumber = v.chassisNumber ? normaliseRegistration(v.chassisNumber) : null;
    if (!registration && !chassisNumber) {
      throw new BadRequestException(
        'Give the vehicle registration number or, if it has none, the chassis number',
      );
    }
    if (!v.ownedByDriver && (!v.ownerName || !v.ownerPhone)) {
      throw new BadRequestException(
        "For a renter-driver, give the vehicle owner's name and phone number",
      );
    }
    return {
      registration,
      chassisNumber,
      type: v.type,
      makeModel: v.makeModel ?? null,
      ownedByDriver: v.ownedByDriver,
      ownerName: v.ownedByDriver ? null : v.ownerName!,
      ownerPhone: v.ownedByDriver ? null : phone(v.ownerPhone, "Owner's phone"),
    };
  }

  async create(dto: CreateDriverDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const main = phone(dto.phone, 'Phone')!;
    const alt = phone(dto.altPhone, 'Alternate phone');
    checkAge(dto.dateOfBirth);
    const nomineePhone = phone(dto.nomineePhone, "Nominee's phone");
    const vehicle = dto.vehicle ? this.vehicleData(dto.vehicle) : null;

    const id = await serializable(this.prisma, async (tx) => {
      const duplicates = await this.findDuplicates(tx, {
        phones: [main, alt].filter(Boolean) as string[],
        registration: vehicle?.registration,
        chassis: vehicle?.chassisNumber,
      });
      if (duplicates.length && !dto.acknowledgeDuplicates) throw possibleDuplicate(duplicates);
      const d = await tx.driver.create({
        data: {
          name: dto.name,
          phone: main,
          altPhone: alt,
          language: dto.language,
          dateOfBirth: dto.dateOfBirth ? parseDateOnly(dto.dateOfBirth) : null,
          addressLine: dto.addressLine,
          area: dto.area ?? null,
          district: dto.district,
          state: dto.state ?? 'West Bengal',
          pinCode: dto.pinCode,
          nomineeName: dto.nomineeName ?? null,
          nomineeRelation: dto.nomineeRelation ?? null,
          nomineePhone,
          notes: dto.notes ?? null,
          createdById: actor.id,
          vehicles: vehicle ? { create: { ...vehicle, createdById: actor.id } } : undefined,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'driver.create',
          tableName: 'drivers',
          recordId: d.id,
          after: {
            ...this.driverFields(d),
            vehicle,
            duplicatesAcknowledged: duplicates.length ? duplicates : undefined,
          },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return d.id;
    });
    return this.get(id);
  }

  async update(id: string, dto: UpdateDriverDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const main = dto.phone !== undefined ? phone(dto.phone, 'Phone')! : undefined;
    const alt = dto.altPhone !== undefined ? phone(dto.altPhone, 'Alternate phone') : undefined;
    const nomineePhone =
      dto.nomineePhone !== undefined ? phone(dto.nomineePhone, "Nominee's phone") : undefined;
    if (dto.dateOfBirth) checkAge(dto.dateOfBirth);

    await serializable(this.prisma, async (tx) => {
      const before = await tx.driver.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Driver not found');
      const newPhones = [main, alt].filter(
        (p): p is string => !!p && p !== before.phone && p !== before.altPhone,
      );
      if (newPhones.length) {
        const duplicates = await this.findDuplicates(tx, { driverId: id, phones: newPhones });
        if (duplicates.length && !dto.acknowledgeDuplicates) throw possibleDuplicate(duplicates);
      }
      const after = await tx.driver.update({
        where: { id },
        data: {
          name: dto.name,
          phone: main,
          altPhone: alt,
          language: dto.language,
          dateOfBirth:
            dto.dateOfBirth === undefined
              ? undefined
              : dto.dateOfBirth
                ? parseDateOnly(dto.dateOfBirth)
                : null,
          addressLine: dto.addressLine,
          area: dto.area,
          district: dto.district,
          state: dto.state,
          pinCode: dto.pinCode,
          nomineeName: dto.nomineeName,
          nomineeRelation: dto.nomineeRelation,
          nomineePhone,
          notes: dto.notes,
          status: dto.status,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action:
            dto.status && dto.status !== before.status
              ? `driver.${dto.status.toLowerCase()}`
              : 'driver.update',
          tableName: 'drivers',
          recordId: id,
          before: this.driverFields(before),
          after: this.driverFields(after),
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Records the driver's current vehicle. A previous vehicle is kept as history. */
  async setVehicle(id: string, dto: VehicleDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const data = this.vehicleData(dto);
    await serializable(this.prisma, async (tx) => {
      const driver = await tx.driver.findUnique({
        where: { id },
        include: { vehicles: { where: { isCurrent: true } } },
      });
      if (!driver) throw new NotFoundException('Driver not found');
      const duplicates = await this.findDuplicates(tx, {
        driverId: id,
        registration: data.registration,
        chassis: data.chassisNumber,
      });
      if (duplicates.length && !dto.acknowledgeDuplicates) throw possibleDuplicate(duplicates);
      const previous = driver.vehicles[0];
      if (previous)
        await tx.vehicle.update({ where: { id: previous.id }, data: { isCurrent: false } });
      const v = await tx.vehicle.create({ data: { ...data, driverId: id, createdById: actor.id } });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: previous ? 'vehicle.replace' : 'vehicle.create',
          tableName: 'vehicles',
          recordId: v.id,
          before: previous ? this.vehicleView(previous) : null,
          after: this.vehicleView(v),
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async uploadOwnerConsent(
    id: string,
    file: UploadedFile | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const upload = checkUpload(file);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { driverId: id, isCurrent: true },
    });
    if (!vehicle) throw new NotFoundException('Record the vehicle first');
    if (vehicle.ownedByDriver)
      throw new ConflictException('The driver owns this vehicle; no owner consent is needed');
    const key = newFileKey('consent', id, upload.ext);
    await this.storage.put(key, file!.buffer, upload.mime);
    await this.prisma.$transaction(async (tx) => {
      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: {
          ownerConsentFileKey: key,
          ownerConsentFileName: upload.originalName,
          ownerConsentFileType: upload.mime,
          ownerConsentUploadedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'vehicle.owner_consent_upload',
          tableName: 'vehicles',
          recordId: vehicle.id,
          after: { fileName: upload.originalName, replaced: !!vehicle.ownerConsentFileKey },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async ownerConsentLink(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const v = await this.prisma.vehicle.findFirst({ where: { driverId: id, isCurrent: true } });
    if (!v?.ownerConsentFileKey) throw new NotFoundException('No owner consent has been uploaded');
    await this.audit.record({
      actorType: 'STAFF',
      actorId: actor.id,
      action: 'vehicle.owner_consent_viewed',
      tableName: 'vehicles',
      recordId: v.id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.links.issue(
      v.ownerConsentFileKey,
      v.ownerConsentFileType!,
      v.ownerConsentFileName!,
    );
  }

  // ---------------------------------------------------------------------------
  // KYC documents
  // ---------------------------------------------------------------------------

  async uploadKyc(
    driverId: string,
    dto: UploadKycDto,
    file: UploadedFile | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const info = KYC_DOC_INFO[dto.type];
    const problem = docNumberProblem(dto.type, dto.number);
    if (problem) throw new BadRequestException(problem);
    if (dto.usedForAddress && !info.canProveAddress) {
      throw new BadRequestException(`${info.label} cannot be used as proof of address`);
    }
    const upload = checkUpload(file);
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const protectedNumber = info.hasNumber ? this.crypto.protect(dto.type, dto.number!) : null;
    if (protectedNumber) {
      const own = await this.prisma.kycDocument.findFirst({
        where: { driverId, numberIndex: protectedNumber.index, status: { not: 'REJECTED' } },
      });
      if (own) throw new ConflictException(`This ${info.label} is already on the driver's file`);
      const duplicates = await this.findDuplicates(this.prisma, {
        driverId,
        docIndexes: [{ index: protectedNumber.index, type: dto.type }],
      });
      if (duplicates.length && !dto.acknowledgeDuplicates) throw possibleDuplicate(duplicates);
    }

    const key = newFileKey('kyc', driverId, upload.ext);
    await this.storage.put(key, file!.buffer, upload.mime);
    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.kycDocument.create({
        data: {
          driverId,
          type: dto.type,
          numberEncrypted: protectedNumber?.encrypted ?? null,
          numberLast4: protectedNumber?.last4 ?? null,
          numberIndex: protectedNumber?.index ?? null,
          usedForAddress: !!dto.usedForAddress,
          fileKey: key,
          fileName: upload.originalName,
          fileType: upload.mime,
          fileSize: upload.size,
          uploadedById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'kyc.upload',
          tableName: 'kyc_documents',
          recordId: doc.id,
          after: {
            driverId,
            type: doc.type,
            maskedNumber: maskDocNumber(doc.type, doc.numberLast4),
            usedForAddress: doc.usedForAddress,
            fileName: doc.fileName,
            duplicatesAcknowledged: dto.acknowledgeDuplicates || undefined,
          },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(driverId);
  }

  private async doc(id: string) {
    const d = await this.prisma.kycDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Document not found');
    return d;
  }

  async verifyKyc(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const d = await this.doc(id);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.kycDocument.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'VERIFIED',
          verifiedById: actor.id,
          verifiedAt: new Date(),
          rejectionReason: null,
        },
      });
      if (!res.count)
        throw new ConflictException(`This document is already ${d.status.toLowerCase()}`);
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'kyc.verify',
          tableName: 'kyc_documents',
          recordId: id,
          before: { status: d.status },
          after: { status: 'VERIFIED' },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(d.driverId);
  }

  async rejectKyc(id: string, dto: RejectKycDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const d = await this.doc(id);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.kycDocument.updateMany({
        where: { id, status: { in: ['PENDING', 'VERIFIED'] } },
        data: {
          status: 'REJECTED',
          verifiedById: actor.id,
          verifiedAt: new Date(),
          rejectionReason: dto.reason,
        },
      });
      if (!res.count) throw new ConflictException('This document is already rejected');
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'kyc.reject',
          tableName: 'kyc_documents',
          recordId: id,
          before: { status: d.status },
          after: { status: 'REJECTED', reason: dto.reason },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.get(d.driverId);
  }

  /** A short-lived link to the document file. Every view is logged (spec section 7). */
  async kycLink(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const d = await this.doc(id);
    await this.audit.record({
      actorType: 'STAFF',
      actorId: actor.id,
      action: 'kyc.document_viewed',
      tableName: 'kyc_documents',
      recordId: id,
      after: { driverId: d.driverId, type: d.type },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.links.issue(d.fileKey, d.fileType, d.fileName);
  }

  /** Shows the full ID number. Every reveal is logged; Aadhaar numbers are not stored in full. */
  async revealNumber(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const d = await this.doc(id);
    if (!d.numberEncrypted) {
      throw new ConflictException(
        d.type === 'AADHAAR'
          ? 'Only the last 4 digits of an Aadhaar number are stored'
          : 'This document has no number stored',
      );
    }
    await this.audit.record({
      actorType: 'STAFF',
      actorId: actor.id,
      action: 'kyc.number_revealed',
      tableName: 'kyc_documents',
      recordId: id,
      after: { driverId: d.driverId, type: d.type },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { number: this.crypto.decrypt(d.numberEncrypted) };
  }
}
