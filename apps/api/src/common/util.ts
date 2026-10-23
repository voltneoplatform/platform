import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

/** Today's date in India Standard Time as YYYY-MM-DD (a business day ends at midnight IST). */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** Converts a DATE column value to YYYY-MM-DD. */
export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Parses YYYY-MM-DD into a Date at UTC midnight, for DATE columns. */
export function parseDateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}

/**
 * Runs a serializable transaction, retrying a few times when two people change
 * the same records at once. Business errors thrown inside are passed through.
 */
export async function serializable<T>(
  prisma: { $transaction: <R>(fn: (tx: Tx) => Promise<R>, opts?: object) => Promise<R> },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (isSerializationFailure(err) && attempt < 4) continue;
      if (isSerializationFailure(err)) {
        throw new ConflictException('Someone else changed this at the same time. Try again.');
      }
      throw err;
    }
  }
}
