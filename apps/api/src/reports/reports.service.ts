import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TRANSFER_DUE_STATES,
  addDays,
  addMonths,
  type AgreementState,
  type CollectionStage,
} from '@voltneo/shared';
import type { LedgerAccount, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionsService } from '../collections/collections.service';
import { CLOCK, type Clock } from '../common/clock';
import { parseDateOnly } from '../common/util';

/** States in which a driver has a Volt Neo battery and pays instalments. */
const RUNNING: AgreementState[] = ['ACTIVE', 'IN_GRACE', 'IMMOBILISED'];
/** Accounts that receive money when a payment comes in. */
const RECEIVING: LedgerAccount[] = ['BANK', 'GATEWAY_CLEARING', 'CASH_WITH_AGENTS'];

const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

interface Period {
  from: string;
  /** Exclusive. */
  to: string;
}

/**
 * Management dashboard (spec module 11). Money received is read from the
 * ledger and checked against the payments it came from, so the figures match
 * the ledger by construction and any difference is shown, not hidden.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collections: CollectionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async received(p: Period) {
    const window = { gte: istStart(p.from), lt: istStart(p.to) };
    const journalWhere: Prisma.LedgerJournalWhereInput = {
      kind: 'PAYMENT',
      payment: { receivedAt: window },
    };
    const [byAccount, payments, byMethod] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['account'],
        where: { journal: journalWhere },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.payment.aggregate({
        where: { receivedAt: window },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { receivedAt: window },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    const credit = (a: LedgerAccount) => byAccount.find((r) => r.account === a)?._sum.credit ?? 0;
    const ledgerTotal = byAccount
      .filter((r) => RECEIVING.includes(r.account))
      .reduce((s, r) => s + (r._sum.debit ?? 0), 0);
    const paymentsTotal = payments._sum.amount ?? 0;
    return {
      total: ledgerTotal,
      count: payments._count,
      downPayments: credit('DOWN_PAYMENTS_RECEIVED'),
      instalments: credit('INSTALMENTS_RECEIVED'),
      lateFees: credit('LATE_FEES_RECEIVED'),
      driverCredit: credit('DRIVER_CREDIT'),
      byMethod: Object.fromEntries(
        byMethod.map((m) => [m.method, { amount: m._sum.amount ?? 0, count: m._count }]),
      ),
      paymentsTotal,
      matchesLedger: paymentsTotal === ledgerTotal,
    };
  }

  /** Instalments falling due in the period on running agreements. */
  private async due(p: Period) {
    const rows = await this.prisma.instalment.findMany({
      where: {
        sequence: { gt: 0 },
        dueDate: { gte: parseDateOnly(p.from), lt: parseDateOnly(p.to) },
        agreement: { state: { in: [...RUNNING, 'PAID_OFF', 'EARLY_EXIT', 'TRANSFERRED'] } },
      },
      select: { amount: true, amountPaid: true },
    });
    const amount = rows.reduce((s, r) => s + r.amount, 0);
    const paid = rows.reduce((s, r) => s + r.amountPaid, 0);
    return { count: rows.length, amount, paid, unpaid: amount - paid };
  }

  async summary(date?: string) {
    const today = this.clock.today();
    const day = date ?? today;
    if (day > today) throw new BadRequestException('The date cannot be in the future');
    const monthStart = `${day.slice(0, 7)}-01`;
    const dayP: Period = { from: day, to: addDays(day, 1) };
    const monthP: Period = { from: monthStart, to: addMonths(monthStart, 1) };
    const now = this.clock.now();

    const [
      states,
      batteries,
      receivedDay,
      receivedMonth,
      dueDay,
      dueMonth,
      overdue,
      lateFees,
      queue,
      tickets,
      transferredMonth,
      cash,
      approvals,
    ] = await Promise.all([
      this.prisma.agreement.groupBy({ by: ['state'], _count: true }),
      this.prisma.battery.groupBy({ by: ['status'], _count: true }),
      this.received(dayP),
      this.received(monthP),
      this.due(dayP),
      this.due(monthP),
      this.prisma.instalment.findMany({
        where: {
          sequence: { gt: 0 },
          dueDate: { lt: parseDateOnly(today) },
          status: { not: 'PAID' },
          agreement: { state: { in: RUNNING } },
        },
        select: { amount: true, amountPaid: true, agreementId: true },
      }),
      this.prisma.lateFeeAccrual.findMany({
        where: { agreement: { state: { in: RUNNING } } },
        select: { amount: true, amountPaid: true },
      }),
      this.collections.queue({}),
      Promise.all([
        this.prisma.serviceTicket.count({ where: { status: 'OPEN' } }),
        this.prisma.serviceTicket.count({ where: { status: 'ASSIGNED' } }),
        this.prisma.serviceTicket.count({
          where: { status: { in: ['OPEN', 'ASSIGNED'] }, respondedAt: null, dueBy: { lt: now } },
        }),
        this.prisma.serviceTicket.findMany({
          where: {
            reportedAt: { gte: istStart(monthP.from), lt: istStart(monthP.to) },
            respondedAt: { not: null },
          },
          select: { respondedAt: true, dueBy: true },
        }),
      ]),
      this.prisma.ownershipTransfer.count({
        where: { transferredAt: { gte: istStart(monthP.from), lt: istStart(monthP.to) } },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['account'],
        where: { account: { in: ['CASH_WITH_AGENTS', 'CASH_IN_TRANSIT', 'DRIVER_CREDIT'] } },
        _sum: { debit: true, credit: true },
      }),
      this.prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);

    const byState = Object.fromEntries(states.map((s) => [s.state, s._count])) as Partial<
      Record<AgreementState, number>
    >;
    const balance = (a: LedgerAccount, side: 'debit' | 'credit') => {
      const r = cash.find((c) => c.account === a);
      const d = r?._sum.debit ?? 0;
      const c = r?._sum.credit ?? 0;
      return side === 'debit' ? d - c : c - d;
    };
    const [open, assigned, missed, respondedThisMonth] = tickets;
    const onTime = respondedThisMonth.filter((t) => t.respondedAt! <= t.dueBy).length;
    const counts = queue.counts as Partial<Record<CollectionStage, number>>;
    return {
      date: day,
      today,
      month: monthStart.slice(0, 7),
      agreements: {
        byState,
        running: RUNNING.reduce((s, st) => s + (byState[st] ?? 0), 0),
        transferDue: TRANSFER_DUE_STATES.reduce((s, st) => s + (byState[st] ?? 0), 0),
        transferredThisMonth: transferredMonth,
      },
      /** One open agreement per driver, so running agreements are active drivers. */
      activeDrivers: RUNNING.reduce((s, st) => s + (byState[st] ?? 0), 0),
      due: { day: dueDay, month: dueMonth },
      received: { day: receivedDay, month: receivedMonth },
      overdue: {
        drivers: new Set(overdue.map((o) => o.agreementId)).size,
        instalments: overdue.reduce((s, o) => s + o.amount - o.amountPaid, 0),
        lateFees: lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0),
        byStage: counts,
      },
      batteries: Object.fromEntries(batteries.map((b) => [b.status, b._count])),
      tickets: {
        open,
        assigned,
        missed,
        respondedThisMonth: respondedThisMonth.length,
        respondedOnTimeThisMonth: onTime,
      },
      cash: {
        withAgents: balance('CASH_WITH_AGENTS', 'debit'),
        inTransit: balance('CASH_IN_TRANSIT', 'debit'),
        driverCredit: balance('DRIVER_CREDIT', 'credit'),
      },
      pendingApprovals: approvals,
    };
  }
}
