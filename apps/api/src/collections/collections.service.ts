import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RECOVERY_AFTER_DAYS,
  addDays,
  canTransition,
  collectionStage,
  finalNoticeDue,
  firstLateFeeDay,
  formatRupees,
  hasPermission,
  immobilisationApprovalAllowed,
  immobilisationRequestAllowed,
  lateFeeApplies,
  recoveryDueOn,
  reminderKind,
  reminderOffset,
  spellDay,
  type AgreementState,
  type CollectionStage,
  type LatePolicy,
  type NoticeKind,
} from '@voltneo/shared';
import type {
  Agreement,
  ApprovalRequest,
  Instalment,
  LateFeeAccrual,
  Prisma,
} from '../generated/prisma/client';
import type { DriverLanguage } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { MessagingService } from '../messaging/messaging.service';
import { TEXTS, docDate } from '../documents/texts';
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
import {
  dateOnly,
  istDate,
  isUniqueViolation,
  parseDateOnly,
  serializable,
  type Tx,
} from '../common/util';
import type { ImmobilisationDto, RecoveryDto, RequestActionDto } from './dto';

/** States the daily run looks at. */
const WATCHED: AgreementState[] = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];
/** How many missed business days the daily run catches up. */
const CATCH_UP_DAYS = 7;
const MINUTE = 60_000;
const MAX_PHOTOS = 6;

export const JOB_DAILY = 'collections-daily';
export const JOB_NOTICES = 'collections-notices';

type WithMoney = Agreement & { instalments: Instalment[]; lateFees: LateFeeAccrual[] };

export interface Overdue {
  instalments: Instalment[];
  /** Unpaid part of every instalment whose due date has passed. */
  overdueAmount: number;
  lateFeesDue: number;
  anyOverdue: boolean;
  oldestDueDate: string | null;
}

/** Overdue as of a date: instalments due before it and not fully paid, plus unpaid late fees. */
export function overdueOf(a: WithMoney, today: string): Overdue {
  const instalments = a.instalments
    .filter((i) => i.sequence > 0 && i.dueDate && dateOnly(i.dueDate)! < today)
    .filter((i) => i.amountPaid < i.amount)
    .sort((x, y) => x.sequence - y.sequence);
  const overdueAmount = instalments.reduce((s, i) => s + i.amount - i.amountPaid, 0);
  const lateFeesDue = a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
  return {
    instalments,
    overdueAmount,
    lateFeesDue,
    anyOverdue: instalments.length > 0 || lateFeesDue > 0,
    oldestDueDate: instalments[0] ? dateOnly(instalments[0].dueDate)! : null,
  };
}

function policyOf(a: Agreement): LatePolicy {
  return {
    graceDays: a.graceDays,
    lateFeePerDayPaise: a.lateFeePerDayPaise,
    lateFeeCapDays: a.lateFeeCapDays,
  };
}

const withMoney = {
  instalments: { orderBy: { sequence: 'asc' } },
  lateFees: { orderBy: { accrualDate: 'asc' } },
} satisfies Prisma.AgreementInclude;

type Actor = {
  type: 'STAFF' | 'SYSTEM';
  id: string | null;
  ip?: string | null;
  requestId?: string | null;
};

@Injectable()
export class CollectionsService implements OnModuleInit {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly messaging: MessagingService,
    private readonly links: FileLinks,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  onModuleInit() {
    // Two people for every immobilisation and recovery (D19): the person who
    // asks and a different operations manager or super admin who approves.
    this.approvals.register('IMMOBILISE', {
      onApprove: async (tx, request) => {
        const a = await this.loadMoney(tx, request.targetId);
        const ov = overdueOf(a, this.clock.today());
        const spell = dateOnly(a.lateSpellStartedOn);
        if (!ov.anyOverdue || !spell) {
          throw new ConflictException(
            'Nothing is overdue any more; this request no longer applies',
          );
        }
        if (!immobilisationApprovalAllowed(spell, this.clock.today(), policyOf(a))) {
          throw new ConflictException(
            `Immobilisation can be approved from ${firstLateFeeDay(spell, policyOf(a))}, after the grace period`,
          );
        }
      },
    });
    this.approvals.register('RECOVER', {
      onApprove: async (tx, request) => {
        const a = await this.loadMoney(tx, request.targetId);
        if (a.state !== 'IMMOBILISED' || a.restoreDueSince) {
          throw new ConflictException('This battery is no longer due for recovery');
        }
      },
    });
  }

  private async loadMoney(tx: Tx | PrismaService, id: string): Promise<WithMoney> {
    const a = await tx.agreement.findUnique({ where: { id }, include: withMoney });
    if (!a) throw new NotFoundException('Agreement not found');
    return a;
  }

  private async event(
    tx: Tx,
    a: Agreement,
    e: { event: string; to: AgreementState; reason?: string | null },
    actor: Actor,
  ) {
    await tx.agreementEvent.create({
      data: {
        agreementId: a.id,
        event: e.event,
        fromState: a.state,
        toState: e.to,
        reason: e.reason ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
  }

  private async auditChange(
    tx: Tx,
    actor: Actor,
    action: string,
    table: string,
    recordId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.audit.record(
      {
        actorType: actor.type,
        actorId: actor.id,
        action,
        tableName: table,
        recordId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        ip: actor.ip ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  }

  // ---------------------------------------------------------------------------
  // Scheduled runs (spec section 6: 00:05 IST daily, 09:00 IST notices)
  // ---------------------------------------------------------------------------

  /**
   * Runs a job once per business date. A date already done is skipped; a
   * failed date can run again. Returns null when skipped.
   */
  private async once<T extends object>(
    job: string,
    date: string,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const runDate = parseDateOnly(date);
    const existing = await this.prisma.jobRun.findUnique({
      where: { job_runDate: { job, runDate } },
    });
    if (existing && existing.status !== 'FAILED') return null;
    try {
      if (existing) {
        const res = await this.prisma.jobRun.updateMany({
          where: { id: existing.id, status: 'FAILED' },
          data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, summary: undefined },
        });
        if (res.count === 0) return null;
      } else {
        await this.prisma.jobRun.create({ data: { job, runDate, status: 'RUNNING' } });
      }
    } catch (err) {
      if (isUniqueViolation(err)) return null; // another worker took it
      throw err;
    }
    try {
      const summary = await fn();
      await this.prisma.jobRun.update({
        where: { job_runDate: { job, runDate } },
        data: { status: 'DONE', finishedAt: new Date(), summary: summary as Prisma.InputJsonValue },
      });
      return summary;
    } catch (err) {
      await this.prisma.jobRun.update({
        where: { job_runDate: { job, runDate } },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: { error: err instanceof Error ? err.message : String(err) },
        },
      });
      throw err;
    }
  }

  /**
   * The daily run for today, catching up any of the previous 7 days that were
   * missed. Missed days are evaluated against today's payments (ASSUMED).
   */
  async runDaily(today = this.clock.today()) {
    const results: { date: string; summary: object | null }[] = [];
    for (let back = CATCH_UP_DAYS - 1; back >= 0; back--) {
      const date = addDays(today, -back);
      // Never invent runs for days before the platform's first run.
      if (back > 0) {
        const anyBefore = await this.prisma.jobRun.findFirst({
          where: { job: JOB_DAILY, runDate: { lt: parseDateOnly(date) } },
          select: { id: true },
        });
        if (!anyBefore) continue;
      }
      results.push({
        date,
        summary: await this.once(JOB_DAILY, date, () => this.processDay(date)),
      });
    }
    return results;
  }

  private async processDay(date: string) {
    const agreements = await this.prisma.agreement.findMany({
      where: { state: { in: WATCHED } },
      select: { id: true },
    });
    const summary = {
      agreements: agreements.length,
      graceStarted: 0,
      lateFees: 0,
      cleared: 0,
      errors: 0,
    };
    for (const { id } of agreements) {
      try {
        const r = await serializable(this.prisma, (tx) => this.processAgreement(tx, id, date));
        summary.graceStarted += r.graceStarted ? 1 : 0;
        summary.lateFees += r.lateFee ? 1 : 0;
        summary.cleared += r.cleared ? 1 : 0;
      } catch (err) {
        summary.errors += 1;
        this.logger.error(`Daily run ${date}, agreement ${id}: ${(err as Error).message}`);
      }
    }
    return summary;
  }

  private async processAgreement(tx: Tx, id: string, date: string) {
    const out = { graceStarted: false, lateFee: false, cleared: false };
    const a = await this.loadMoney(tx, id);
    if (!WATCHED.includes(a.state)) return out;
    const system: Actor = { type: 'SYSTEM', id: null };
    const ov = overdueOf(a, date);

    if (!ov.anyOverdue) {
      if (a.lateSpellStartedOn || a.state === 'IN_GRACE') {
        await tx.agreement.update({
          where: { id },
          data: {
            lateSpellStartedOn: null,
            ...(a.state === 'IN_GRACE' ? { state: 'ACTIVE' } : {}),
          },
        });
        if (a.state === 'IN_GRACE') {
          await this.event(tx, a, { event: 'OVERDUE_CLEARED', to: 'ACTIVE' }, system);
        }
        out.cleared = true;
      }
      return out;
    }

    const spell = dateOnly(a.lateSpellStartedOn) ?? ov.oldestDueDate ?? date;
    if (!a.lateSpellStartedOn) {
      await tx.agreement.update({
        where: { id },
        data: { lateSpellStartedOn: parseDateOnly(spell) },
      });
    }
    if (a.state === 'ACTIVE' && canTransition('ACTIVE', 'IN_GRACE')) {
      const first = ov.instalments[0];
      await tx.agreement.update({ where: { id }, data: { state: 'IN_GRACE' } });
      await this.event(
        tx,
        a,
        {
          event: 'GRACE_STARTED',
          to: 'IN_GRACE',
          reason: first
            ? `Instalment ${first.sequence} due ${dateOnly(first.dueDate)} not paid`
            : 'Late fees unpaid',
        },
        system,
      );
      await this.auditChange(
        tx,
        system,
        'agreement.grace',
        'agreements',
        id,
        { state: a.state },
        {
          state: 'IN_GRACE',
          lateSpellStartedOn: spell,
        },
      );
      out.graceStarted = true;
    }

    const feeDays = await tx.lateFeeAccrual.count({
      where: { agreementId: id, accrualDate: { gte: parseDateOnly(spell) } },
    });
    if (
      lateFeeApplies({
        spellStartedOn: spell,
        today: date,
        feeDaysAlreadyCharged: feeDays,
        instalmentOverdue: ov.instalments.length > 0,
        policy: policyOf(a),
      })
    ) {
      const created = await tx.lateFeeAccrual.createMany({
        data: [
          {
            agreementId: id,
            instalmentId: ov.instalments[0]!.id,
            accrualDate: parseDateOnly(date),
            amount: a.lateFeePerDayPaise,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count) {
        out.lateFee = true;
        await this.auditChange(tx, system, 'late_fee.accrue', 'late_fee_accruals', id, null, {
          agreementNumber: a.number,
          date,
          amount: a.lateFeePerDayPaise,
          spellStartedOn: spell,
          feeDay: feeDays + 1,
          capDays: a.lateFeeCapDays,
        });
      }
    }
    return out;
  }

  /** Reminders (5, 3, 1 day before and on the due date) and final notices, sent at 09:00 IST. */
  async runNotices(today = this.clock.today()) {
    const messageIds: string[] = [];
    const summary = await this.once(JOB_NOTICES, today, async () => {
      const agreements = await this.prisma.agreement.findMany({
        where: { state: { in: WATCHED } },
        include: { ...withMoney, driver: true },
      });
      const counts = { reminders: 0, finalNotices: 0 };
      for (const a of agreements) {
        const lang = a.driver.language as DriverLanguage;
        const t = TEXTS[lang];
        for (const i of a.instalments) {
          if (i.sequence === 0 || !i.dueDate || i.amountPaid >= i.amount) continue;
          const offset = reminderOffset(dateOnly(i.dueDate)!, today);
          if (offset === null) continue;
          const id = await this.notice(a.id, reminderKind(offset), dateOnly(i.dueDate)!, i.id, {
            driverId: a.driverId,
            phone: a.driver.phone,
            lang,
            body: t.reminderSms({
              amount: formatRupees(i.amount - i.amountPaid),
              agreement: a.number,
              dueDate: docDate(dateOnly(i.dueDate)!),
              today: offset === 0,
            }),
          });
          if (id) {
            messageIds.push(id);
            counts.reminders += 1;
          }
        }
        const spell = dateOnly(a.lateSpellStartedOn);
        const ov = overdueOf(a, today);
        if (
          spell &&
          a.state === 'IN_GRACE' &&
          !a.immobilisedAt &&
          ov.anyOverdue &&
          finalNoticeDue(spell, today, policyOf(a))
        ) {
          const id = await this.notice(a.id, 'FINAL_NOTICE', spell, ov.instalments[0]?.id ?? null, {
            driverId: a.driverId,
            phone: a.driver.phone,
            lang,
            body: t.finalNoticeSms({
              amount: formatRupees(ov.overdueAmount + ov.lateFeesDue),
              agreement: a.number,
              disableFrom: docDate(firstLateFeeDay(spell, policyOf(a))),
              fee: formatRupees(a.lateFeePerDayPaise),
            }),
          });
          if (id) {
            messageIds.push(id);
            counts.finalNotices += 1;
          }
        }
      }
      return counts;
    });
    await this.messaging.deliver(messageIds);
    return summary;
  }

  /** Records a notice once per agreement, kind and date, and queues its SMS. */
  private async notice(
    agreementId: string,
    kind: NoticeKind,
    refDate: string,
    instalmentId: string | null,
    m: { driverId: string; phone: string; lang: DriverLanguage; body: string },
    tx?: Tx,
  ): Promise<string | null> {
    const run = async (t: Tx) => {
      const existing = await t.collectionNotice.findUnique({
        where: {
          agreementId_kind_refDate: { agreementId, kind, refDate: parseDateOnly(refDate) },
        },
      });
      if (existing) return null;
      const messageId = await this.messaging.queue(t, {
        driverId: m.driverId,
        toPhone: m.phone,
        channel: 'SMS',
        template: kind.toLowerCase(),
        language: m.lang,
        body: m.body,
        agreementId,
      });
      await t.collectionNotice.create({
        data: { agreementId, kind, refDate: parseDateOnly(refDate), instalmentId, messageId },
      });
      return messageId;
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  // ---------------------------------------------------------------------------
  // After a payment (called inside the payment's transaction)
  // ---------------------------------------------------------------------------

  /**
   * When nothing is overdue any more: the late spell ends, an overdue agreement
   * is active again, a disabled battery gets a restore task, and requests that
   * no longer apply are cancelled (spec rules 10-11).
   */
  async afterPayment(tx: Tx, agreementId: string, actor: Actor) {
    const a = await this.loadMoney(tx, agreementId);
    if (!['ACTIVE', 'IN_GRACE', 'IMMOBILISED', 'PAID_OFF', 'EARLY_EXIT'].includes(a.state)) return;
    if (overdueOf(a, this.clock.today()).anyOverdue) return;
    const data: Prisma.AgreementUpdateInput = {};
    if (a.lateSpellStartedOn) data.lateSpellStartedOn = null;
    if (a.state === 'IN_GRACE') {
      data.state = 'ACTIVE';
      await this.event(tx, a, { event: 'OVERDUE_CLEARED', to: 'ACTIVE' }, actor);
    }
    if (a.immobilisedAt && !a.restoreDueSince) {
      data.restoreDueSince = this.clock.now();
      await this.event(
        tx,
        a,
        { event: 'RESTORE_DUE', to: a.state, reason: 'All dues paid: switch the battery back on' },
        actor,
      );
    }
    if (Object.keys(data).length) await tx.agreement.update({ where: { id: a.id }, data });
    for (const type of ['IMMOBILISE', 'RECOVER'] as const) {
      await this.approvals.cancelBySystem(
        tx,
        { type, targetTable: 'agreements', targetId: a.id },
        'Cancelled automatically: the driver paid everything overdue',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Queue and agreement view (module 9)
  // ---------------------------------------------------------------------------

  private async requestsFor(ids: string[], tx: Tx | PrismaService = this.prisma) {
    const requests = await tx.approvalRequest.findMany({
      where: {
        targetTable: 'agreements',
        targetId: { in: ids },
        type: { in: ['IMMOBILISE', 'RECOVER'] },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      orderBy: { requestedAt: 'desc' },
    });
    const usedImm = await tx.immobilisationLog.findMany({
      where: { approvalRequestId: { in: requests.map((r) => r.id) } },
      select: { approvalRequestId: true },
    });
    const usedRec = await tx.recovery.findMany({
      where: { approvalRequestId: { in: requests.map((r) => r.id) } },
      select: { approvalRequestId: true },
    });
    const used = new Set([...usedImm, ...usedRec].map((u) => u.approvalRequestId));
    const open = requests.filter((r) => !used.has(r.id));
    const pick = (id: string, type: 'IMMOBILISE' | 'RECOVER') =>
      open.find((r) => r.targetId === id && r.type === type) ?? null;
    return { pick };
  }

  private stageOf(
    a: WithMoney,
    today: string,
    imm: ApprovalRequest | null,
    rec: ApprovalRequest | null,
  ): CollectionStage | null {
    return collectionStage({
      today,
      policy: policyOf(a),
      recoveryAfterDays: RECOVERY_AFTER_DAYS,
      spellStartedOn: dateOnly(a.lateSpellStartedOn),
      immobilisedOn: a.immobilisedAt ? istDate(a.immobilisedAt) : null,
      restoreDue: !!a.restoreDueSince,
      immobilisationRequest: imm ? (imm.status as 'PENDING' | 'APPROVED') : null,
      recoveryRequest: rec ? (rec.status as 'PENDING' | 'APPROVED') : null,
    });
  }

  async queue(q: { stage?: CollectionStage }) {
    const today = this.clock.today();
    const rows = await this.prisma.agreement.findMany({
      where: {
        OR: [
          { state: { in: ['IN_GRACE', 'IMMOBILISED'] } },
          { lateSpellStartedOn: { not: null } },
          { restoreDueSince: { not: null } },
        ],
      },
      include: {
        ...withMoney,
        driver: { select: { id: true, name: true, phone: true, area: true, district: true } },
        vehicle: { select: { registration: true, chassisNumber: true } },
        battery: { select: { serial: true, gpsDeviceId: true } },
      },
    });
    const { pick } = await this.requestsFor(rows.map((r) => r.id));
    const items = rows
      .map((a) => {
        const imm = pick(a.id, 'IMMOBILISE');
        const rec = pick(a.id, 'RECOVER');
        const stage = this.stageOf(a, today, imm, rec);
        const ov = overdueOf(a, today);
        const spell = dateOnly(a.lateSpellStartedOn);
        return {
          agreementId: a.id,
          number: a.number,
          state: a.state,
          stage,
          driver: a.driver,
          vehicle: a.vehicle.registration ?? a.vehicle.chassisNumber,
          battery: a.battery,
          spellStartedOn: spell,
          daysOverdue: spell ? spellDay(spell, today) : 0,
          overdueAmount: ov.overdueAmount,
          lateFeesDue: ov.lateFeesDue,
          toClear: ov.overdueAmount + ov.lateFeesDue,
          immobilisedAt: a.immobilisedAt,
          recoveryDueOn: a.immobilisedAt
            ? recoveryDueOn(istDate(a.immobilisedAt), RECOVERY_AFTER_DAYS)
            : null,
          restoreDueSince: a.restoreDueSince,
          immobilisationRequest: imm ? { id: imm.id, status: imm.status } : null,
          recoveryRequest: rec ? { id: rec.id, status: rec.status } : null,
        };
      })
      .filter((r) => r.stage !== null && (!q.stage || r.stage === q.stage))
      .sort((x, y) =>
        x.stage === 'RESTORE_DUE' && y.stage !== 'RESTORE_DUE'
          ? -1
          : y.stage === 'RESTORE_DUE' && x.stage !== 'RESTORE_DUE'
            ? 1
            : y.daysOverdue - x.daysOverdue,
      );
    const counts: Partial<Record<CollectionStage, number>> = {};
    for (const r of items) counts[r.stage!] = (counts[r.stage!] ?? 0) + 1;
    const runs = await this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 6 });
    return {
      today,
      counts,
      items,
      lastRuns: runs.map((r) => ({
        job: r.job,
        date: dateOnly(r.runDate),
        status: r.status,
        summary: r.summary,
        finishedAt: r.finishedAt,
      })),
    };
  }

  async forAgreement(id: string) {
    const today = this.clock.today();
    const a = await this.prisma.agreement.findUnique({
      where: { id },
      include: {
        ...withMoney,
        immobilisations: { orderBy: { performedAt: 'desc' } },
        recoveries: { include: { photos: true } },
        notices: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    const { pick } = await this.requestsFor([id]);
    const imm = pick(id, 'IMMOBILISE');
    const rec = pick(id, 'RECOVER');
    const ov = overdueOf(a, today);
    const spell = dateOnly(a.lateSpellStartedOn);
    const policy = policyOf(a);
    const staffIds = [
      ...a.immobilisations.flatMap((l) => [l.performedById, l.recordedById]),
      ...a.recoveries.flatMap((r) => [r.recoveredById, r.recordedById]),
      imm?.requestedById,
      rec?.requestedById,
    ].filter(Boolean) as string[];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: [...new Set(staffIds)] } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    const stage = this.stageOf(a, today, imm, rec);
    const recovery = a.recoveries[0] ?? null;
    return {
      today,
      stage,
      spellStartedOn: spell,
      daysOverdue: spell ? spellDay(spell, today) : 0,
      overdueAmount: ov.overdueAmount,
      lateFeesDue: ov.lateFeesDue,
      toClear: ov.overdueAmount + ov.lateFeesDue,
      lateFeeFrom: spell ? firstLateFeeDay(spell, policy) : null,
      lateFeeDaysInSpell: spell
        ? a.lateFees.filter((f) => dateOnly(f.accrualDate)! >= spell).length
        : 0,
      lateFeeCapDays: a.lateFeeCapDays,
      immobilisedAt: a.immobilisedAt,
      recoveryDueOn: a.immobilisedAt
        ? recoveryDueOn(istDate(a.immobilisedAt), RECOVERY_AFTER_DAYS)
        : null,
      restoreDueSince: a.restoreDueSince,
      immobilisationRequest: imm
        ? {
            id: imm.id,
            status: imm.status,
            requestedByName: names.get(imm.requestedById) ?? null,
            requestedAt: imm.requestedAt,
          }
        : null,
      recoveryRequest: rec
        ? {
            id: rec.id,
            status: rec.status,
            requestedByName: names.get(rec.requestedById) ?? null,
            requestedAt: rec.requestedAt,
          }
        : null,
      allowed: {
        requestImmobilisation:
          !!spell &&
          a.state === 'IN_GRACE' &&
          !imm &&
          !a.immobilisedAt &&
          ov.instalments.length > 0 &&
          immobilisationRequestAllowed(spell, today, policy),
        recordDisable: imm?.status === 'APPROVED' && !a.immobilisedAt && ov.anyOverdue,
        recordRestore: !!a.immobilisedAt,
        requestRecovery:
          a.state === 'IMMOBILISED' &&
          !a.restoreDueSince &&
          !rec &&
          !!a.immobilisedAt &&
          today >= recoveryDueOn(istDate(a.immobilisedAt), RECOVERY_AFTER_DAYS),
        recordRecovery: rec?.status === 'APPROVED' && a.state === 'IMMOBILISED',
      },
      log: a.immobilisations.map((l) => ({
        id: l.id,
        action: l.action,
        performedAt: l.performedAt,
        performedByName: names.get(l.performedById) ?? null,
        recordedByName: names.get(l.recordedById) ?? null,
        portalReference: l.portalReference,
        vehicleStationaryConfirmed: l.vehicleStationaryConfirmed,
        note: l.note,
      })),
      recovery: recovery
        ? {
            id: recovery.id,
            recoveredAt: recovery.recoveredAt,
            recoveredByName: names.get(recovery.recoveredById) ?? null,
            location: recovery.location,
            conditionNote: recovery.conditionNote,
            writtenOffAmount: recovery.writtenOffAmount,
            writtenOffLateFees: recovery.writtenOffLateFees,
            photos: recovery.photos.map((p) => ({ id: p.id, fileName: p.fileName })),
          }
        : null,
      notices: a.notices.map((n) => ({
        kind: n.kind,
        refDate: dateOnly(n.refDate),
        createdAt: n.createdAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Immobilisation (rules 8-9, 11; D19, D23)
  // ---------------------------------------------------------------------------

  async requestImmobilisation(
    id: string,
    dto: RequestActionDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const today = this.clock.today();
    return serializable(this.prisma, async (tx) => {
      const a = await this.loadMoney(tx, id);
      const ov = overdueOf(a, today);
      const spell = dateOnly(a.lateSpellStartedOn);
      if (a.state !== 'IN_GRACE' || !spell || ov.instalments.length === 0 || a.immobilisedAt) {
        throw new ConflictException('This agreement is not overdue');
      }
      if (!immobilisationRequestAllowed(spell, today, policyOf(a))) {
        throw new ConflictException(
          `Immobilisation can be requested from day ${a.graceDays} of the grace period (${addDays(spell, a.graceDays)})`,
        );
      }
      const { pick } = await this.requestsFor([id], tx);
      if (pick(id, 'IMMOBILISE')) {
        throw new ConflictException('An immobilisation request is already open for this agreement');
      }
      return this.approvals.create(
        tx,
        {
          type: 'IMMOBILISE',
          targetTable: 'agreements',
          targetId: id,
          summary: `Disable battery for ${a.number}: ${formatRupees(ov.overdueAmount + ov.lateFeesDue)} overdue since ${spell}`,
          reason: dto.reason,
          payload: {
            agreementNumber: a.number,
            spellStartedOn: spell,
            overdueAmount: ov.overdueAmount,
            lateFeesDue: ov.lateFeesDue,
            approvableFrom: firstLateFeeDay(spell, policyOf(a)),
          },
        },
        actor,
        meta,
      );
    });
  }

  async recordImmobilisation(
    id: string,
    dto: ImmobilisationDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const performedAt = new Date(dto.performedAt);
    if (performedAt.getTime() > this.clock.now().getTime() + MINUTE) {
      throw new BadRequestException('The time cannot be in the future');
    }
    const performedById = dto.performedById ?? actor.id;
    const messageIds: string[] = [];
    await serializable(this.prisma, async (tx) => {
      const a = await tx.agreement.findUnique({
        where: { id },
        include: { ...withMoney, driver: true },
      });
      if (!a) throw new NotFoundException('Agreement not found');
      const performer = await tx.staffUser.findUnique({ where: { id: performedById } });
      if (
        !performer ||
        performer.status !== 'ACTIVE' ||
        !hasPermission(performer.role, 'collections.assign')
      ) {
        throw new BadRequestException(
          'Choose an active staff member who may act in the GPS portal',
        );
      }
      const today = this.clock.today();
      const ov = overdueOf(a, today);
      const actorInfo: Actor = {
        type: 'STAFF',
        id: actor.id,
        ip: meta.ip,
        requestId: meta.requestId,
      };
      const lang = a.driver.language as DriverLanguage;

      if (dto.action === 'DISABLE') {
        if (!dto.vehicleStationaryConfirmed) {
          throw new BadRequestException(
            'Confirm the vehicle was stationary in the GPS portal before disabling (rule D6)',
          );
        }
        if (a.state !== 'IN_GRACE' || !ov.anyOverdue || a.immobilisedAt) {
          throw new ConflictException('This battery cannot be disabled now: nothing is overdue');
        }
        const { pick } = await this.requestsFor([id], tx);
        const approved = pick(id, 'IMMOBILISE');
        if (approved?.status !== 'APPROVED') {
          throw new ConflictException('Disabling needs an approved immobilisation request first');
        }
        if (performedAt.getTime() < (approved.decidedAt?.getTime() ?? 0) - MINUTE) {
          throw new BadRequestException('The battery cannot have been disabled before approval');
        }
        const log = await tx.immobilisationLog.create({
          data: {
            agreementId: id,
            action: 'DISABLE',
            approvalRequestId: approved.id,
            vehicleStationaryConfirmed: true,
            portalReference: dto.portalReference,
            performedAt,
            performedById,
            recordedById: actor.id,
            note: dto.note ?? null,
          },
        });
        await tx.agreement.update({
          where: { id },
          data: { state: 'IMMOBILISED', immobilisedAt: performedAt, restoreDueSince: null },
        });
        await this.event(
          tx,
          a,
          { event: 'IMMOBILISED', to: 'IMMOBILISED', reason: `Portal ref ${dto.portalReference}` },
          actorInfo,
        );
        await this.auditChange(
          tx,
          actorInfo,
          'agreement.immobilise',
          'immobilisation_log',
          log.id,
          null,
          log,
        );
        const mid = await this.notice(
          id,
          'IMMOBILISED',
          istDate(performedAt),
          null,
          {
            driverId: a.driverId,
            phone: a.driver.phone,
            lang,
            body: TEXTS[lang].immobilisedSms({
              amount: formatRupees(ov.overdueAmount + ov.lateFeesDue),
              agreement: a.number,
            }),
          },
          tx,
        );
        if (mid) messageIds.push(mid);
        return;
      }

      // RESTORE
      if (!a.immobilisedAt) throw new ConflictException('This battery is not disabled');
      if (performedAt.getTime() < a.immobilisedAt.getTime() - MINUTE) {
        throw new BadRequestException(
          'The battery cannot have been restored before it was disabled',
        );
      }
      if (ov.anyOverdue && !dto.note) {
        throw new BadRequestException(
          'Dues are still unpaid. Give the reason for switching the battery back on (for example an emergency)',
        );
      }
      const log = await tx.immobilisationLog.create({
        data: {
          agreementId: id,
          action: 'RESTORE',
          vehicleStationaryConfirmed: !!dto.vehicleStationaryConfirmed,
          portalReference: dto.portalReference,
          performedAt,
          performedById,
          recordedById: actor.id,
          note: dto.note ?? null,
        },
      });
      const to: AgreementState =
        a.state === 'IMMOBILISED' ? (ov.anyOverdue ? 'IN_GRACE' : 'ACTIVE') : a.state;
      await tx.agreement.update({
        where: { id },
        data: { state: to, immobilisedAt: null, restoreDueSince: null },
      });
      await this.event(
        tx,
        a,
        {
          event: ov.anyOverdue ? 'RESTORED_WITHOUT_PAYMENT' : 'RESTORED',
          to,
          reason: dto.note ?? `Portal ref ${dto.portalReference}`,
        },
        actorInfo,
      );
      await this.auditChange(
        tx,
        actorInfo,
        'agreement.restore',
        'immobilisation_log',
        log.id,
        null,
        log,
      );
      const mid = await this.notice(
        id,
        'RESTORED',
        istDate(performedAt),
        null,
        {
          driverId: a.driverId,
          phone: a.driver.phone,
          lang,
          body: TEXTS[lang].restoredSms({ agreement: a.number }),
        },
        tx,
      );
      if (mid) messageIds.push(mid);
    });
    await this.messaging.deliver(messageIds);
    return this.forAgreement(id);
  }

  // ---------------------------------------------------------------------------
  // Recovery (rule 12; D39, D45)
  // ---------------------------------------------------------------------------

  async requestRecovery(
    id: string,
    dto: RequestActionDto,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const today = this.clock.today();
    return serializable(this.prisma, async (tx) => {
      const a = await this.loadMoney(tx, id);
      if (a.state !== 'IMMOBILISED' || !a.immobilisedAt || a.restoreDueSince) {
        throw new ConflictException('Recovery applies only to a disabled battery with dues unpaid');
      }
      const due = recoveryDueOn(istDate(a.immobilisedAt), RECOVERY_AFTER_DAYS);
      if (today < due) {
        throw new ConflictException(
          `Recovery is due from ${due}, 30 days after the battery was disabled`,
        );
      }
      const { pick } = await this.requestsFor([id], tx);
      if (pick(id, 'RECOVER')) throw new ConflictException('A recovery request is already open');
      const ov = overdueOf(a, today);
      return this.approvals.create(
        tx,
        {
          type: 'RECOVER',
          targetTable: 'agreements',
          targetId: id,
          summary: `Recover battery for ${a.number}: disabled since ${istDate(a.immobilisedAt)}, ${formatRupees(ov.overdueAmount + ov.lateFeesDue)} unpaid`,
          reason: dto.reason,
          payload: {
            agreementNumber: a.number,
            immobilisedOn: istDate(a.immobilisedAt),
            dueFrom: due,
          },
        },
        actor,
        meta,
      );
    });
  }

  async recordRecovery(
    id: string,
    dto: RecoveryDto,
    files: UploadedFile[] | undefined,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const photos = (files ?? []).map((f) => ({ file: f, upload: checkUpload(f) }));
    if (photos.length > MAX_PHOTOS)
      throw new BadRequestException(`Attach at most ${MAX_PHOTOS} photos`);
    if (photos.some((p) => p.upload.ext === 'pdf')) {
      throw new BadRequestException('Recovery photos must be JPEG, PNG or WebP images');
    }
    const recoveredAt = new Date(dto.recoveredAt);
    if (recoveredAt.getTime() > this.clock.now().getTime() + MINUTE) {
      throw new BadRequestException('The time cannot be in the future');
    }
    const keys = photos.map((p) => newFileKey('recoveries', id, p.upload.ext));
    let stored = false;
    await serializable(this.prisma, async (tx) => {
      const a = await tx.agreement.findUnique({
        where: { id },
        include: { ...withMoney, battery: true },
      });
      if (!a) throw new NotFoundException('Agreement not found');
      if (a.state !== 'IMMOBILISED' || !a.battery) {
        throw new ConflictException(
          'Recovery applies only to an agreement with a disabled battery',
        );
      }
      if (dto.batteryId !== a.battery.id) {
        throw new UnprocessableEntityException(
          `The battery collected must be ${a.battery.serial}, the one on this agreement`,
        );
      }
      const { pick } = await this.requestsFor([id], tx);
      const approved = pick(id, 'RECOVER');
      if (approved?.status !== 'APPROVED') {
        throw new ConflictException('Recovery needs an approved recovery request first');
      }
      if (recoveredAt.getTime() < (approved.decidedAt?.getTime() ?? 0) - MINUTE) {
        throw new BadRequestException('The battery cannot have been collected before approval');
      }
      const collector = await tx.staffUser.findUnique({ where: { id: dto.recoveredById } });
      if (
        !collector ||
        collector.status !== 'ACTIVE' ||
        !hasPermission(collector.role, 'recovery.record')
      ) {
        throw new BadRequestException('Choose an active staff member who may recover batteries');
      }
      if (!stored) {
        for (let i = 0; i < photos.length; i++) {
          await this.storage.put(keys[i]!, photos[i]!.file.buffer, photos[i]!.upload.mime);
        }
        stored = true;
      }
      const paid = a.instalments.reduce((s, i) => s + i.amountPaid, 0);
      const writtenOffAmount = a.totalPayable - paid;
      const writtenOffLateFees = a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
      const recovery = await tx.recovery.create({
        data: {
          agreementId: id,
          batteryId: a.battery.id,
          approvalRequestId: approved.id,
          recoveredAt,
          recoveredById: collector.id,
          location: dto.location,
          conditionNote: dto.conditionNote,
          writtenOffAmount,
          writtenOffLateFees,
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
      // The battery comes back to Volt Neo (custody log, rule 17).
      await tx.battery.update({
        where: { id: a.battery.id },
        data: {
          status: 'RECOVERED',
          holder: 'RECOVERED',
          holderDriverId: null,
          holderStaffId: collector.id,
          location: dto.location,
        },
      });
      await tx.batteryCustody.create({
        data: {
          batteryId: a.battery.id,
          event: 'RECOVERED',
          fromStatus: a.battery.status,
          toStatus: 'RECOVERED',
          fromHolder: a.battery.holder,
          toHolder: 'RECOVERED',
          toLocation: dto.location,
          toStaffId: collector.id,
          note: `Agreement ${a.number}`,
          byId: actor.id,
        },
      });
      const actorInfo: Actor = {
        type: 'STAFF',
        id: actor.id,
        ip: meta.ip,
        requestId: meta.requestId,
      };
      await tx.agreement.update({
        where: { id },
        data: {
          state: 'CLOSED',
          closedAt: this.clock.now(),
          writtenOffAmount,
          writtenOffLateFees,
          lateSpellStartedOn: null,
          restoreDueSince: null,
        },
      });
      await this.event(
        tx,
        a,
        { event: 'RECOVERED', to: 'RECOVERED', reason: dto.location },
        actorInfo,
      );
      await tx.agreementEvent.create({
        data: {
          agreementId: id,
          event: 'CLOSED',
          fromState: 'RECOVERED',
          toState: 'CLOSED',
          reason: `Written off: ${formatRupees(writtenOffAmount)} instalments, ${formatRupees(writtenOffLateFees)} late fees (D45). Down payment kept (D44).`,
          actorType: 'STAFF',
          actorId: actor.id,
        },
      });
      await this.auditChange(
        tx,
        actorInfo,
        'agreement.recover',
        'recoveries',
        recovery.id,
        null,
        recovery,
      );
    });
    return this.forAgreement(id);
  }

  async recoveryPhotoLink(agreementId: string, photoId: string) {
    const photo = await this.prisma.recoveryPhoto.findUnique({
      where: { id: photoId },
      include: { recovery: { select: { agreementId: true } } },
    });
    if (!photo || photo.recovery.agreementId !== agreementId) {
      throw new NotFoundException('Photo not found');
    }
    return this.links.issue(photo.fileKey, photo.fileType, photo.fileName);
  }
}
