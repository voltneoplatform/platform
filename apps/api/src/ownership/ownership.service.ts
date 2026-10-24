import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EARLY_EXIT_STATES,
  TRANSFER_DUE_STATES,
  certificateNumber,
  earlyExitQuote,
  financialYear,
  formatRupees,
  hasPermission,
  type AgreementState,
} from '@voltneo/shared';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import { DocumentsService } from '../documents/documents.service';
import { PaymentsService } from '../payments/payments.service';
import { TEXTS } from '../documents/texts';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import { nextCounter } from '../common/counters';
import { dateOnly, istDate, parseDateOnly, serializable, type Tx } from '../common/util';
import type { FinishEarlyDto, TransferDto } from './dto';

const MINUTE = 60_000;
const OPEN_TICKET = ['OPEN', 'ASSIGNED'] as const;

/**
 * Finishing early (rule 13, clause E7) and ownership transfer (rule 14, clause
 * E9, D32): the end of a Neo Own agreement that was paid in full.
 */
@Injectable()
export class OwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly documents: DocumentsService,
    private readonly payments: PaymentsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async load(id: string, tx: Tx | PrismaService = this.prisma) {
    const a = await tx.agreement.findUnique({
      where: { id },
      include: {
        driver: true,
        battery: true,
        batteryType: true,
        instalments: { orderBy: { sequence: 'asc' } },
        lateFees: { orderBy: { accrualDate: 'asc' } },
        transfer: true,
      },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    return a;
  }

  private quoteFor(a: Awaited<ReturnType<OwnershipService['load']>>) {
    return earlyExitQuote({
      today: this.clock.today(),
      instalments: a.instalments.map((i) => ({
        sequence: i.sequence,
        dueDate: dateOnly(i.dueDate),
        amount: i.amount,
        amountPaid: i.amountPaid,
      })),
      lateFees: a.lateFees,
    });
  }

  /** Money held for the driver (gateway overpayments), owed back to them. */
  private async driverCredit(agreementId: string, tx: Tx | PrismaService = this.prisma) {
    const s = await tx.ledgerEntry.aggregate({
      where: { agreementId, account: 'DRIVER_CREDIT' },
      _sum: { credit: true, debit: true },
    });
    return (s._sum.credit ?? 0) - (s._sum.debit ?? 0);
  }

  private async blockers(
    a: { id: string; immobilisedAt: Date | null; state: AgreementState },
    tx: Tx | PrismaService = this.prisma,
  ): Promise<string[]> {
    const out: string[] = [];
    if (a.immobilisedAt) {
      out.push(
        'The battery is still disabled. Switch it back on in the GPS portal and record it under Collections first.',
      );
    }
    const open = await tx.serviceTicket.count({
      where: { agreementId: a.id, status: { in: [...OPEN_TICKET] } },
    });
    if (open) {
      out.push(
        `${open === 1 ? 'A service ticket is' : `${open} service tickets are`} still open. Resolve or cancel ${open === 1 ? 'it' : 'them'} first: the fault was reported while Volt Neo owned the battery.`,
      );
    }
    return out;
  }

  /** Everything the agreement page needs about finishing early and transfer. */
  async view(id: string) {
    const a = await this.load(id);
    const state = a.state as AgreementState;
    const canFinishEarly = EARLY_EXIT_STATES.includes(state);
    const transferDue = TRANSFER_DUE_STATES.includes(state);
    const [credit, blockers, names] = await Promise.all([
      this.driverCredit(id),
      transferDue ? this.blockers(a) : Promise.resolve([] as string[]),
      a.transfer
        ? this.prisma.staffUser.findMany({
            where: { id: { in: [a.transfer.gpsOffById, a.transfer.recordedById] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const name = (sid: string) => names.find((n) => n.id === sid)?.name ?? null;
    return {
      agreementId: a.id,
      state,
      earlyExit: canFinishEarly ? { quotedOn: this.clock.today(), ...this.quoteFor(a) } : null,
      transferDue,
      paidInFullOn: a.completedAt ? istDate(a.completedAt) : null,
      blockers,
      driverCredit: credit,
      battery: a.battery
        ? { id: a.battery.id, serial: a.battery.serial, gpsDeviceId: a.battery.gpsDeviceId }
        : null,
      transfer: a.transfer
        ? {
            id: a.transfer.id,
            certificateNumber: a.transfer.certificateNumber,
            paidInFullOn: dateOnly(a.transfer.paidInFullOn),
            gpsOffAt: a.transfer.gpsOffAt,
            gpsPortalReference: a.transfer.gpsPortalReference,
            gpsOffByName: name(a.transfer.gpsOffById),
            transferredAt: a.transfer.transferredAt,
            recordedByName: name(a.transfer.recordedById),
            note: a.transfer.note,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Finishing early (rule 13; D30, D40, D44)
  // ---------------------------------------------------------------------------

  async finishEarly(id: string, dto: FinishEarlyDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    if (dto.agreementId !== id) {
      throw new BadRequestException('The payment is for a different agreement');
    }
    const a = await this.load(id);
    if (!EARLY_EXIT_STATES.includes(a.state as AgreementState)) {
      throw new ConflictException(
        'Finishing early applies only to an agreement with the battery installed',
      );
    }
    const quote = this.quoteFor(a);
    if (dto.quotedTotalPaise !== quote.total || dto.amountPaise !== quote.total) {
      throw new ConflictException({
        message: `The amount to finish early is now ${formatRupees(quote.total)}. Check the new figure with the driver.`,
        code: 'QUOTE_CHANGED',
        total: quote.total,
      });
    }
    const payment = await this.payments.record(
      { ...dto, note: dto.note ?? 'Finished early (clause E7)' },
      actor,
      meta,
    );
    return { payment, ownership: await this.view(id) };
  }

  // ---------------------------------------------------------------------------
  // Ownership transfer (rule 14; D32; Schedule 8)
  // ---------------------------------------------------------------------------

  async transfer(id: string, dto: TransferDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const gpsOffAt = new Date(dto.gpsOffAt);
    if (gpsOffAt.getTime() > this.clock.now().getTime() + MINUTE) {
      throw new BadRequestException('The time cannot be in the future');
    }
    const messageId = await serializable(this.prisma, async (tx) => {
      const a = await this.load(id, tx);
      if (a.state === 'TRANSFERRED') {
        throw new ConflictException('Ownership has already been transferred');
      }
      if (!TRANSFER_DUE_STATES.includes(a.state as AgreementState) || !a.completedAt) {
        throw new ConflictException(
          'Ownership passes to the driver only once the agreement is paid in full',
        );
      }
      const blockers = await this.blockers(a, tx);
      if (blockers.length) throw new ConflictException(blockers[0]);
      if (!a.battery) throw new ConflictException('This agreement has no battery recorded');
      if (gpsOffAt.getTime() < a.completedAt.getTime() - MINUTE) {
        throw new BadRequestException(
          'The GPS module cannot have been switched off before the agreement was paid in full',
        );
      }
      const by = await tx.staffUser.findUnique({ where: { id: dto.gpsOffById } });
      if (!by || by.status !== 'ACTIVE' || !hasPermission(by.role, 'transfers.record')) {
        throw new BadRequestException(
          'Choose an active staff member who may switch off GPS modules',
        );
      }

      const now = this.clock.now();
      const today = this.clock.today();
      const fy = financialYear(today);
      const number = certificateNumber(fy, await nextCounter(tx, `certificate:${fy}`));
      const record = await tx.ownershipTransfer.create({
        data: {
          agreementId: id,
          batteryId: a.battery.id,
          driverId: a.driverId,
          certificateNumber: number,
          paidInFullOn: parseDateOnly(istDate(a.completedAt)),
          gpsOffAt,
          gpsPortalReference: dto.gpsPortalReference,
          gpsOffById: by.id,
          transferredAt: now,
          recordedById: actor.id,
          note: dto.note ?? null,
        },
      });

      // The battery now belongs to the driver (custody log, rule 17).
      await tx.battery.update({
        where: { id: a.battery.id },
        data: {
          status: 'TRANSFERRED',
          holder: 'DRIVER',
          holderDriverId: a.driverId,
          holderStaffId: null,
        },
      });
      await tx.batteryCustody.create({
        data: {
          batteryId: a.battery.id,
          event: 'OWNERSHIP_TRANSFERRED',
          fromStatus: a.battery.status,
          toStatus: 'TRANSFERRED',
          fromHolder: a.battery.holder,
          toHolder: 'DRIVER',
          toLocation: a.battery.location,
          toDriverId: a.driverId,
          note: `Agreement ${a.number}, certificate ${number}; GPS module off (${dto.gpsPortalReference})`,
          byId: actor.id,
        },
      });
      await tx.agreement.update({ where: { id }, data: { state: 'TRANSFERRED' } });
      await tx.agreementEvent.create({
        data: {
          agreementId: id,
          event: 'TRANSFERRED',
          fromState: a.state,
          toState: 'TRANSFERRED',
          reason: `Certificate ${number}; GPS module switched off (portal ref ${dto.gpsPortalReference}); service ended (D32)`,
          actorType: 'STAFF',
          actorId: actor.id,
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'agreement.transfer',
          tableName: 'ownership_transfers',
          recordId: record.id,
          after: record,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      const lang = a.driver.language as DriverLanguage;
      return this.messaging.queue(tx, {
        driverId: a.driverId,
        toPhone: a.driver.phone,
        channel: 'SMS',
        template: 'ownership_transferred',
        language: lang,
        body: TEXTS[lang].transferredSms({
          agreement: a.number,
          serial: a.battery.serial,
          certificate: number,
        }),
        agreementId: id,
      });
    });
    await this.messaging.deliver([messageId]);
    return this.view(id);
  }

  async certificate(id: string, lang: DriverLanguage | undefined) {
    const a = await this.load(id);
    const t = a.transfer;
    if (!t) throw new NotFoundException('No ownership transfer has been recorded yet');
    const battery = await this.prisma.battery.findUnique({ where: { id: t.batteryId } });
    const pdf = await this.documents.certificate(
      {
        certificateNumber: t.certificateNumber,
        driverName: a.driver.name,
        agreementNumber: a.number,
        agreementDate: istDate(a.signedAt ?? a.createdAt),
        batteryType: a.batteryType.name,
        serial: battery?.serial ?? '',
        totalPayable: a.totalPayable,
        paidInFullOn: dateOnly(t.paidInFullOn)!,
        transferredOn: istDate(t.transferredAt),
        gpsOffOn: istDate(t.gpsOffAt),
      },
      lang ?? (a.driver.language as DriverLanguage),
    );
    return { pdf, fileName: `certificate-${t.certificateNumber.replace(/\//g, '-')}.pdf` };
  }
}
