import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LEDGER_ACCOUNTS, formatRupees, hasPermission, type LedgerAccount } from '@voltneo/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { serializable, type Tx } from '../common/util';
import type { CashDepositDto, ListDepositsQuery, ReconcileDto } from './dto';

/**
 * Cash collected by agents, paid into the bank, and checked by finance
 * (spec module 8: cash is tied to the collecting agent).
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async net(
    tx: Tx | PrismaService,
    account: LedgerAccount,
    staffId?: string,
  ): Promise<Map<string, { debit: number; credit: number }>> {
    const rows = await tx.ledgerEntry.groupBy({
      by: ['staffId'],
      where: { account, staffId: staffId ?? { not: null } },
      _sum: { debit: true, credit: true },
    });
    return new Map(
      rows.map((r) => [r.staffId!, { debit: r._sum.debit ?? 0, credit: r._sum.credit ?? 0 }]),
    );
  }

  /** Cash each agent is holding, and how much of what they paid in is still unchecked. */
  async holdings() {
    const [withAgents, inTransit] = await Promise.all([
      this.net(this.prisma, 'CASH_WITH_AGENTS'),
      this.net(this.prisma, 'CASH_IN_TRANSIT'),
    ]);
    const ids = [...new Set([...withAgents.keys(), ...inTransit.keys()])];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, role: true },
    });
    return staff
      .map((s) => {
        const w = withAgents.get(s.id) ?? { debit: 0, credit: 0 };
        const t = inTransit.get(s.id) ?? { debit: 0, credit: 0 };
        return {
          agentId: s.id,
          agentName: s.name,
          role: s.role,
          collected: w.debit,
          paidIn: w.credit,
          held: w.debit - w.credit,
          awaitingCheck: t.debit - t.credit,
        };
      })
      .sort((a, b) => b.held - a.held || a.agentName.localeCompare(b.agentName));
  }

  private async view(rows: Prisma.CashDepositGetPayload<object>[]) {
    const ids = [
      ...new Set(rows.flatMap((r) => [r.agentId, r.recordedById, r.reconciledById])),
    ].filter(Boolean) as string[];
    const staff = await this.prisma.staffUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentName: names.get(r.agentId) ?? null,
      amount: r.amount,
      bankReference: r.bankReference,
      depositedAt: r.depositedAt,
      status: r.status,
      recordedById: r.recordedById,
      recordedByName: names.get(r.recordedById) ?? null,
      reconciledByName: r.reconciledById ? (names.get(r.reconciledById) ?? null) : null,
      reconciledAt: r.reconciledAt,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }

  async list(q: ListDepositsQuery) {
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    const where: Prisma.CashDepositWhereInput = { status: q.status, agentId: q.agentId };
    const [total, rows] = await Promise.all([
      this.prisma.cashDeposit.count({ where }),
      this.prisma.cashDeposit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { total, page, limit, items: await this.view(rows) };
  }

  async deposit(dto: CashDepositDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    const agentId = dto.agentId ?? actor.id;
    if (agentId !== actor.id && !hasPermission(actor.role, 'cash_deposits.reconcile')) {
      throw new ForbiddenException('You can only record your own bank deposits');
    }
    const depositedAt = new Date(dto.depositedAt);
    if (depositedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException('The deposit time cannot be in the future');
    }
    const id = await serializable(this.prisma, async (tx) => {
      const held = (await this.net(tx, 'CASH_WITH_AGENTS', agentId)).get(agentId);
      const holding = held ? held.debit - held.credit : 0;
      if (dto.amountPaise > holding) {
        throw new UnprocessableEntityException(
          `That is more than the ${formatRupees(holding)} cash this agent is holding`,
        );
      }
      const d = await tx.cashDeposit.create({
        data: {
          agentId,
          amount: dto.amountPaise,
          bankReference: dto.bankReference,
          depositedAt,
          recordedById: actor.id,
          note: dto.note ?? null,
        },
      });
      await tx.ledgerJournal.create({
        data: {
          kind: 'CASH_DEPOSIT',
          memo: `Cash paid into bank, ref ${dto.bankReference}`,
          cashDepositId: d.id,
          createdById: actor.id,
          entries: {
            create: [
              { account: 'CASH_IN_TRANSIT', staffId: agentId, debit: d.amount },
              { account: 'CASH_WITH_AGENTS', staffId: agentId, credit: d.amount },
            ],
          },
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'cash_deposit.create',
          tableName: 'cash_deposits',
          recordId: d.id,
          after: d,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return d.id;
    });
    return (
      await this.view([await this.prisma.cashDeposit.findUniqueOrThrow({ where: { id } })])
    )[0];
  }

  /**
   * Finance confirms the money reached the bank. PROPOSED maker-checker: the
   * person who checks it is neither the agent nor whoever recorded the deposit.
   */
  async reconcile(id: string, dto: ReconcileDto, actor: AuthenticatedStaff, meta: RequestMeta) {
    await serializable(this.prisma, async (tx) => {
      const before = await tx.cashDeposit.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Deposit not found');
      if (before.status !== 'PENDING')
        throw new ConflictException('This deposit is already checked');
      if (actor.id === before.agentId || actor.id === before.recordedById) {
        throw new ForbiddenException(
          'A different person must check this deposit against the bank statement',
        );
      }
      const after = await tx.cashDeposit.update({
        where: { id },
        data: {
          status: 'RECONCILED',
          reconciledById: actor.id,
          reconciledAt: new Date(),
          note: dto.note ?? before.note,
        },
      });
      await tx.ledgerJournal.create({
        data: {
          kind: 'CASH_RECONCILED',
          memo: `Deposit ref ${before.bankReference} found in bank`,
          cashDepositId: id,
          createdById: actor.id,
          entries: {
            create: [
              { account: 'BANK', debit: before.amount },
              { account: 'CASH_IN_TRANSIT', staffId: before.agentId, credit: before.amount },
            ],
          },
        },
      });
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'cash_deposit.reconcile',
          tableName: 'cash_deposits',
          recordId: id,
          before,
          after,
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return (
      await this.view([await this.prisma.cashDeposit.findUniqueOrThrow({ where: { id } })])
    )[0];
  }

  /** Totals per ledger account (debits, credits and the net). */
  async ledgerBalances() {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      _sum: { debit: true, credit: true },
    });
    const byAccount = new Map(rows.map((r) => [r.account, r._sum]));
    const accounts = LEDGER_ACCOUNTS.map((account) => {
      const s = byAccount.get(account);
      const debit = s?.debit ?? 0;
      const credit = s?.credit ?? 0;
      return { account, debit, credit, net: debit - credit };
    });
    const totals = accounts.reduce(
      (t, a) => ({ debit: t.debit + a.debit, credit: t.credit + a.credit }),
      { debit: 0, credit: 0 },
    );
    return { accounts, totals, balanced: totals.debit === totals.credit };
  }
}
