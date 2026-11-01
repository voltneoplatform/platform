import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { normaliseIndianMobile, type DriverLanguage } from '@voltneo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { CLOCK, type Clock } from '../common/clock';
import type { AuthenticatedStaff } from '../common/decorators';
import type { Tx } from '../common/util';
import { generateOtpCode, hashOtp, safeEqualHex } from '../auth/crypto';
import { DRIVER_CODE_SENDER, type DriverCodeSender } from '../driver-auth/driver-code-sender';

/** The code works for 10 minutes; once entered, the check can be used for 30 minutes. */
export const REGISTRATION_CODE_TTL_SECONDS = 600;
export const PHONE_CHECK_VALID_SECONDS = 1800;

const BAD_CODE = 'The code is wrong or has expired. Send a new code.';

/**
 * Founder, 1 Nov 2026: staff registering a driver send a code to the driver's
 * phone, and the driver reads it out. The driver hears the consent line first
 * (REGISTRATION_CONSENT). A confirmed check is used once, by the same staff
 * member, to save that number on a driver.
 */
@Injectable()
export class PhoneChecksService {
  private readonly logger = new Logger(PhoneChecksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DRIVER_CODE_SENDER) private readonly sender: DriverCodeSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private phoneOf(raw: string): string {
    const phone = normaliseIndianMobile(raw);
    if (!phone) throw new BadRequestException('Phone must be a 10-digit Indian mobile number');
    return phone;
  }

  async send(
    raw: { phone: string; language: DriverLanguage; name?: string },
    actor: AuthenticatedStaff,
  ) {
    const phone = this.phoneOf(raw.phone);
    const language = this.sender.canSend(raw.language, 'registration')
      ? raw.language
      : (['EN', 'BN', 'HI'] as const).find((l) => this.sender.canSend(l, 'registration'));
    if (!language) {
      throw new HttpException(
        'Registration codes cannot be sent yet (the SMS template is not approved).',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const now = this.clock.now();
    const latest = await this.prisma.driverPhoneCheck.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    const cooldownMs = this.config.otpResendCooldownSeconds * 1000;
    if (latest && now.getTime() - latest.createdAt.getTime() < cooldownMs) {
      const wait = Math.ceil((cooldownMs - (now.getTime() - latest.createdAt.getTime())) / 1000);
      throw new HttpException(
        `A code was sent just now. Wait ${wait} seconds before sending another.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = generateOtpCode();
    const id = randomUUID();
    await this.prisma.driverPhoneCheck.create({
      data: {
        id,
        phone,
        codeHash: hashOtp(this.config.otpHashSecret, id, code),
        staffId: actor.id,
        expiresAt: new Date(now.getTime() + REGISTRATION_CODE_TTL_SECONDS * 1000),
        createdAt: now,
      },
    });
    try {
      await this.sender.send({
        phone,
        code,
        language,
        names: [raw.name?.trim() || 'new driver'],
        purpose: 'registration',
      });
    } catch (err) {
      this.logger.error(`Registration code delivery failed for ${phone}`, err as Error);
      throw new HttpException(
        'Could not send the code. Try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { checkId: id, phone, expiresInSeconds: REGISTRATION_CODE_TTL_SECONDS };
  }

  async confirm(checkId: string, code: string, actor: AuthenticatedStaff) {
    const now = this.clock.now();
    const c = await this.prisma.driverPhoneCheck.findUnique({ where: { id: checkId } });
    if (!c || c.staffId !== actor.id || c.usedAt || c.expiresAt <= now) {
      throw new UnprocessableEntityException(BAD_CODE);
    }
    if (c.verifiedAt) return { checkId: c.id, phone: c.phone, confirmed: true as const };
    const counted = await this.prisma.driverPhoneCheck.updateMany({
      where: { id: c.id, verifiedAt: null, attempts: { lt: this.config.otpMaxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) throw new UnprocessableEntityException(BAD_CODE);
    if (!safeEqualHex(c.codeHash, hashOtp(this.config.otpHashSecret, c.id, code))) {
      throw new UnprocessableEntityException(BAD_CODE);
    }
    await this.prisma.driverPhoneCheck.update({ where: { id: c.id }, data: { verifiedAt: now } });
    return { checkId: c.id, phone: c.phone, confirmed: true as const };
  }

  /**
   * Uses a confirmed check for this phone, inside the caller's transaction.
   * Returns when the driver gave the code (their consent time).
   */
  async use(
    tx: Tx,
    checkId: string | undefined | null,
    phone: string,
    driverId: string,
    actor: AuthenticatedStaff,
  ): Promise<Date> {
    const missing = () =>
      new UnprocessableEntityException({
        message: "Confirm the driver's mobile number with the code sent to it first",
        code: 'PHONE_NOT_CONFIRMED',
      });
    if (!checkId) throw missing();
    const c = await tx.driverPhoneCheck.findUnique({ where: { id: checkId } });
    const now = this.clock.now();
    if (
      !c ||
      !c.verifiedAt ||
      c.usedAt ||
      c.staffId !== actor.id ||
      c.phone !== phone ||
      now.getTime() - c.verifiedAt.getTime() > PHONE_CHECK_VALID_SECONDS * 1000
    ) {
      throw missing();
    }
    const used = await tx.driverPhoneCheck.updateMany({
      where: { id: c.id, usedAt: null },
      data: { usedAt: now, usedForDriverId: driverId },
    });
    if (used.count === 0) throw missing();
    return c.verifiedAt;
  }
}
