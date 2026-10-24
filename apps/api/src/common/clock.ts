import { Global, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { istDate } from './util';

/**
 * The time the business logic sees. Collections rules depend on "today" in
 * India; tests move this clock forward day by day instead of waiting.
 */
export interface Clock {
  now(): Date;
  /** Today's date in India, YYYY-MM-DD. */
  today(): string;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now() {
    return new Date();
  }
  today() {
    return istDate(this.now());
  }
}

/** Automated tests only: follows real time until a date is set. */
@Injectable()
export class TestClock implements Clock {
  private fixed: Date | null = null;

  /** Sets the clock to 10:00 IST on the given date (YYYY-MM-DD), or to an exact time. */
  set(at: string | Date) {
    this.fixed = typeof at === 'string' ? new Date(`${at}T10:00:00+05:30`) : at;
  }

  reset() {
    this.fixed = null;
  }

  now() {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  today() {
    return istDate(this.now());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: CLOCK,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.nodeEnv === 'test' ? new TestClock() : new SystemClock(),
    },
  ],
  exports: [CLOCK],
})
export class ClockModule {}
