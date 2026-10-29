import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PAYABLE_STATES, formatRupees } from '@voltneo/shared';
import type { PaymentLink, Prisma } from '../generated/prisma/client';
import type { DriverLanguage } from '../generated/prisma/enums';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import { PAY_LINK_BASE } from '../messaging/sms-templates';
import { TEXTS, docDate } from '../documents/texts';
import type { AuthenticatedStaff, RequestMeta } from '../common/decorators';
import { CLOCK, type Clock } from '../common/clock';
import { istDate, isUniqueViolation, serializable, type Tx } from '../common/util';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway';
import { WebhooksService } from './webhooks.service';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 8 random letters and digits (about 47 bits): the code in https://api.voltcompany.in/p/<code>. */
export function newShortCode(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) {
    if (b >= 248) continue; // keep the spread even (248 = 4 × 62)
    out += BASE62[b % 62];
    if (out.length === 8) return out;
  }
  return newShortCode();
}

/** The address sent by SMS: our short link, or the gateway's own for links made before short codes. */
export function smsLinkUrl(link: Pick<PaymentLink, 'shortCode' | 'url'>): string {
  return link.shortCode ? `${PAY_LINK_BASE}${link.shortCode}` : link.url;
}

const DAY = 86_400_000;

/**
 * UPI payment links sent to drivers by SMS (spec section 7; M5). One open link
 * per agreement; a new link replaces the old one. The gateway's signed webhook
 * records the payment like any other (clause B10) and sends the receipt SMS.
 */
@Injectable()
export class PaymentLinksService {
  private readonly logger = new Logger(PaymentLinksService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly webhooks: WebhooksService,
  ) {}

  view(l: PaymentLink, names: Map<string, string> = new Map()) {
    return {
      id: l.id,
      linkId: l.linkId,
      gateway: l.gateway,
      url: l.url,
      /** The address the driver gets by SMS. */
      smsUrl: smsLinkUrl(l),
      amount: l.amount,
      status: l.status,
      expiresAt: l.expiresAt,
      paymentId: l.paymentId,
      closedAt: l.closedAt,
      closedNote: l.closedNote,
      createdAt: l.createdAt,
      createdByName: l.createdById ? (names.get(l.createdById) ?? null) : null,
    };
  }

  /** Marks open links past their expiry as expired (the gateway also reports it). */
  private async expireStale(tx: Tx | PrismaService, agreementId: string) {
    await tx.paymentLink.updateMany({
      where: { agreementId, status: 'ACTIVE', expiresAt: { lt: this.clock.now() } },
      data: { status: 'EXPIRED', closedAt: this.clock.now(), closedNote: 'Expired' },
    });
  }

  /** The most a link may ask for: everything still owed (down payment only before installation). */
  private owed(
    a: Prisma.AgreementGetPayload<{ include: { instalments: true; lateFees: true } }>,
  ): number {
    if (a.state === 'AWAITING_DOWN_PAYMENT') {
      const dp = a.instalments.find((i) => i.sequence === 0);
      return dp ? dp.amount - dp.amountPaid : 0;
    }
    const paid = a.instalments.reduce((s, i) => s + i.amountPaid, 0);
    const fees = a.lateFees.reduce((s, f) => s + f.amount - f.amountPaid, 0);
    return a.totalPayable - paid + fees;
  }

  async list(agreementId: string) {
    await this.expireStale(this.prisma, agreementId);
    const rows = await this.prisma.paymentLink.findMany({
      where: { agreementId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const ids = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
    const staff = ids.length
      ? await this.prisma.staffUser.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    return {
      gateway: this.gateway.name,
      canSimulate: this.gateway.name === 'fake',
      items: rows.map((r) => this.view(r, new Map(staff.map((s) => [s.id, s.name])))),
    };
  }

  async create(
    agreementId: string,
    amountPaise: number,
    actor: AuthenticatedStaff,
    meta: RequestMeta,
  ) {
    const a = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      include: { driver: true, instalments: true, lateFees: true },
    });
    if (!a) throw new NotFoundException('Agreement not found');
    if (!(PAYABLE_STATES as readonly string[]).includes(a.state)) {
      throw new ConflictException(
        a.state === 'AWAITING_INSTALLATION'
          ? 'The down payment is complete; instalments can be paid once the battery is installed'
          : 'This agreement cannot take payments in its current state',
      );
    }
    const owed = this.owed(a);
    if (amountPaise > owed) {
      throw new UnprocessableEntityException({
        message: `That is more than the ${formatRupees(owed)} still owed`,
        code: 'OVERPAYMENT',
        outstanding: owed,
      });
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.paymentLinkDays * DAY);
    const linkId = `VNL_${a.number}_${randomBytes(4).toString('hex')}`;
    const created = await this.gateway.createLink({
      linkId,
      amountPaise,
      purpose: `Volt Neo agreement ${a.number}`,
      customer: { phone: a.driver.phone, name: a.driver.name },
      expiresAt,
      agreementNumber: a.number,
    });

    let replaced: string[] = [];
    let result: { id: string; messageId: string };
    try {
      result = await serializable(this.prisma, async (tx) => {
        await this.expireStale(tx, a.id);
        const open = await tx.paymentLink.findMany({
          where: { agreementId: a.id, status: 'ACTIVE' },
        });
        if (open.length) {
          await tx.paymentLink.updateMany({
            where: { id: { in: open.map((o) => o.id) } },
            data: { status: 'CANCELLED', closedAt: now, closedNote: 'Replaced by a new link' },
          });
          replaced = open.map((o) => o.linkId);
        }
        const link = await tx.paymentLink.create({
          data: {
            linkId,
            agreementId: a.id,
            driverId: a.driverId,
            gateway: this.gateway.name,
            gatewayRef: created.gatewayRef,
            url: created.url,
            shortCode: newShortCode(),
            amount: amountPaise,
            purpose: `Volt Neo agreement ${a.number}`,
            expiresAt,
            createdById: actor.id,
          },
        });
        await this.audit.record(
          {
            actorType: 'STAFF',
            actorId: actor.id,
            action: 'payment_link.create',
            tableName: 'payment_links',
            recordId: link.id,
            after: { ...link, agreementId: a.id, replaced },
            ip: meta.ip,
            requestId: meta.requestId,
          },
          tx,
        );
        const messageId = await this.queueSms(tx, link, a.number, {
          driverId: a.driverId,
          phone: a.driver.phone,
          language: a.driver.language as DriverLanguage,
        });
        return { id: link.id, messageId };
      });
    } catch (err) {
      // The gateway link exists but was not saved: close it so it cannot be paid.
      await this.gateway.cancelLink(linkId).catch(() => undefined);
      if (isUniqueViolation(err)) {
        throw new ConflictException('Someone else sent a link at the same time. Try again.');
      }
      throw err;
    }
    for (const old of replaced) {
      await this.gateway.cancelLink(old).catch((e: Error) => {
        this.logger.warn(`Could not cancel old link ${old} at the gateway: ${e.message}`);
      });
    }
    await this.messaging.deliver([result.messageId]);
    return this.list(a.id);
  }

  private queueSms(
    tx: Tx,
    link: PaymentLink,
    agreementNumber: string,
    to: { driverId: string; phone: string; language: DriverLanguage },
  ) {
    return this.messaging.queue(tx, {
      driverId: to.driverId,
      toPhone: to.phone,
      channel: 'SMS',
      template: 'payment_link',
      language: to.language,
      body: TEXTS[to.language].paymentLinkSms({
        amount: formatRupees(link.amount),
        agreement: agreementNumber,
        url: smsLinkUrl(link),
        until: docDate(istDate(link.expiresAt)),
      }),
      agreementId: link.agreementId,
    });
  }

  /**
   * Where a short link leads: the gateway's payment page while the link is open,
   * otherwise why it is closed. Public: the driver opens it from the SMS.
   */
  async resolveShortCode(
    code: string,
  ): Promise<{ redirect: string } | { closed: 'PAID' | 'CLOSED' | 'UNKNOWN' }> {
    if (!/^[A-Za-z0-9]{8}$/.test(code)) return { closed: 'UNKNOWN' };
    const l = await this.prisma.paymentLink.findUnique({ where: { shortCode: code } });
    if (!l) return { closed: 'UNKNOWN' };
    if (l.status === 'PAID') return { closed: 'PAID' };
    if (l.status === 'ACTIVE' && l.expiresAt > this.clock.now()) return { redirect: l.url };
    return { closed: 'CLOSED' };
  }

  private async load(id: string) {
    const l = await this.prisma.paymentLink.findUnique({
      where: { id },
      include: { agreement: { include: { driver: true } } },
    });
    if (!l) throw new NotFoundException('Payment link not found');
    return l;
  }

  async resend(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const l = await this.load(id);
    await this.expireStale(this.prisma, l.agreementId);
    const messageId = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.paymentLink.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'ACTIVE') throw new ConflictException('This link is no longer open');
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'payment_link.resend',
          tableName: 'payment_links',
          recordId: id,
          after: { agreementId: l.agreementId, to: l.agreement.driver.phone },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return this.queueSms(tx, fresh, l.agreement.number, {
        driverId: l.agreement.driverId,
        phone: l.agreement.driver.phone,
        language: l.agreement.driver.language as DriverLanguage,
      });
    });
    await this.messaging.deliver([messageId]);
    return this.list(l.agreementId);
  }

  async cancel(id: string, actor: AuthenticatedStaff, meta: RequestMeta) {
    const l = await this.load(id);
    if (l.status !== 'ACTIVE') throw new ConflictException('This link is no longer open');
    await this.gateway.cancelLink(l.linkId);
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.paymentLink.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', closedAt: this.clock.now(), closedNote: 'Cancelled by staff' },
      });
      if (!n.count) throw new ConflictException('This link is no longer open');
      await this.audit.record(
        {
          actorType: 'STAFF',
          actorId: actor.id,
          action: 'payment_link.cancel',
          tableName: 'payment_links',
          recordId: id,
          after: { agreementId: l.agreementId, status: 'CANCELLED' },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
    });
    return this.list(l.agreementId);
  }

  /**
   * Development and tests only: pretends the driver paid a fake link, through
   * the same path a real gateway webhook takes.
   */
  async simulatePaid(id: string) {
    if (this.gateway.name !== 'fake' || this.config.nodeEnv === 'production') {
      throw new ForbiddenException('Only pretend links can be marked paid by hand');
    }
    const l = await this.load(id);
    if (l.status !== 'ACTIVE') throw new ConflictException('This link is no longer open');
    const ref = `FAKE${randomBytes(6).toString('hex').toUpperCase()}`;
    const outcome = await this.webhooks.process(
      'fake',
      {
        kind: 'payment',
        eventId: `fake:${l.linkId}`,
        linkId: l.linkId,
        amountPaise: l.amount,
        method: 'UPI',
        providerRef: ref,
        paidAt: this.clock.now().toISOString(),
      },
      { simulated: true, linkId: l.linkId, providerRef: ref },
    );
    return { outcome, links: await this.list(l.agreementId) };
  }
}
