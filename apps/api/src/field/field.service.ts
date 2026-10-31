import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { hasPermission, recoveryDueOn, RECOVERY_AFTER_DAYS } from '@voltneo/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedStaff } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import { istDate } from '../common/util';

const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

/**
 * What the Field App shows each person (M5): their own cash, installations and
 * tickets, and approved recoveries. Everything else uses the same endpoints as
 * the admin panel, under the same permissions.
 */
@Injectable()
export class FieldService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async cashHeld(staffId: string) {
    const rows = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      where: { staffId, account: { in: ['CASH_WITH_AGENTS', 'CASH_IN_TRANSIT'] } },
      _sum: { debit: true, credit: true },
    });
    const net = (a: string) => {
      const r = rows.find((x) => x.account === a);
      return (r?._sum.debit ?? 0) - (r?._sum.credit ?? 0);
    };
    return { held: net('CASH_WITH_AGENTS'), awaitingCheck: net('CASH_IN_TRANSIT') };
  }

  /** Counts for the home screen, by what the person's role can do. */
  async summary(me: AuthenticatedStaff) {
    const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(me.role, p);
    const now = this.clock.now();
    const today = this.clock.today();
    const [cash, collectedToday, installations, tickets, missed, recoveries] = await Promise.all([
      can('payments.collect_cash') ? this.cashHeld(me.id) : null,
      can('payments.collect_cash')
        ? this.prisma.payment.aggregate({
            where: { collectedById: me.id, receivedAt: { gte: istDayStart(today) } },
            _sum: { amount: true },
            _count: true,
          })
        : null,
      can('installations.record')
        ? this.prisma.agreement.count({
            where: {
              state: 'AWAITING_INSTALLATION',
              // Not those already installed and waiting for head office to verify.
              installations: { none: { needsVerification: true, decision: { is: null } } },
            },
          })
        : null,
      can('tickets.resolve')
        ? this.prisma.serviceTicket.count({ where: { technicianId: me.id, status: 'ASSIGNED' } })
        : null,
      can('tickets.resolve')
        ? this.prisma.serviceTicket.count({
            where: {
              technicianId: me.id,
              status: 'ASSIGNED',
              respondedAt: null,
              dueBy: { lt: now },
            },
          })
        : null,
      can('recovery.record') ? this.recoveryJobs().then((r) => r.length) : null,
    ]);
    return {
      today,
      cash: cash
        ? {
            ...cash,
            collectedToday: collectedToday?._sum.amount ?? 0,
            paymentsToday: collectedToday?._count ?? 0,
          }
        : null,
      installationsWaiting: installations,
      myOpenTickets: tickets,
      myMissedTickets: missed,
      recoveryJobs: recoveries,
    };
  }

  /** The person's cash: what they hold, and the cash payments they took. */
  async myCash(me: AuthenticatedStaff) {
    if (!hasPermission(me.role, 'payments.collect_cash')) {
      throw new ForbiddenException('Your role does not collect cash');
    }
    const [cash, payments, deposits] = await Promise.all([
      this.cashHeld(me.id),
      this.prisma.payment.findMany({
        where: { collectedById: me.id },
        include: {
          agreement: { select: { id: true, number: true } },
          driver: { select: { name: true } },
        },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      }),
      this.prisma.cashDeposit.findMany({
        where: { agentId: me.id },
        orderBy: { depositedAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      ...cash,
      payments: payments.map((p) => ({
        id: p.id,
        receiptNumber: p.receiptNumber,
        amount: p.amount,
        receivedAt: p.receivedAt,
        agreement: p.agreement,
        driverName: p.driver.name,
      })),
      deposits: deposits.map((d) => ({
        id: d.id,
        amount: d.amount,
        bankReference: d.bankReference,
        depositedAt: d.depositedAt,
        status: d.status,
      })),
    };
  }

  /** Approved recoveries not yet collected (rule 12): the recovery team's list. */
  async recoveryJobs() {
    const approved = await this.prisma.approvalRequest.findMany({
      where: { type: 'RECOVER', status: 'APPROVED', targetTable: 'agreements' },
      orderBy: { decidedAt: 'asc' },
    });
    if (!approved.length) return [];
    const used = await this.prisma.recovery.findMany({
      where: { approvalRequestId: { in: approved.map((r) => r.id) } },
      select: { approvalRequestId: true },
    });
    const open = approved.filter((r) => !used.some((u) => u.approvalRequestId === r.id));
    const agreements = await this.prisma.agreement.findMany({
      where: { id: { in: open.map((r) => r.targetId) }, state: 'IMMOBILISED' },
      include: { driver: true, vehicle: true, battery: true },
    });
    return open
      .map((r) => {
        const a = agreements.find((x) => x.id === r.targetId);
        if (!a) return null;
        return {
          agreementId: a.id,
          number: a.number,
          approvedAt: r.decidedAt,
          disabledOn: a.immobilisedAt ? istDate(a.immobilisedAt) : null,
          dueFrom: a.immobilisedAt
            ? recoveryDueOn(istDate(a.immobilisedAt), RECOVERY_AFTER_DAYS)
            : null,
          driver: {
            name: a.driver.name,
            phone: a.driver.phone,
            address: [a.driver.addressLine, a.driver.area, a.driver.district, a.driver.pinCode]
              .filter(Boolean)
              .join(', '),
          },
          vehicle: a.vehicle.registration ?? a.vehicle.chassisNumber,
          battery: a.battery
            ? { id: a.battery.id, serial: a.battery.serial, gpsDeviceId: a.battery.gpsDeviceId }
            : null,
        };
      })
      .filter((x) => x !== null);
  }
}
