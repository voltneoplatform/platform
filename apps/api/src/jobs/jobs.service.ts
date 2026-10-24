import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CollectionsService } from '../collections/collections.service';

export const QUEUE_NAME = 'voltneo-scheduled';

/**
 * Scheduled jobs (MVP Spec section 6). Times are India Standard Time. Each job
 * is safe to run twice: the work itself records which business dates are done.
 */
export const SCHEDULES = [
  {
    id: 'collections-daily',
    pattern: '5 0 * * *',
    tz: 'Asia/Kolkata',
    what: 'Mark overdue agreements, start grace, add late fees',
  },
  {
    id: 'collections-notices',
    pattern: '0 9 * * *',
    tz: 'Asia/Kolkata',
    what: 'Send payment reminders and final notices',
  },
] as const;

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly collections: CollectionsService,
  ) {}

  async onModuleInit() {
    if (!this.config.jobsEnabled) return;
    const connection: ConnectionOptions = { url: this.config.redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE_NAME, { connection });
    for (const s of SCHEDULES) {
      await this.queue.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: s.tz },
        { name: s.id, opts: { removeOnComplete: 100, removeOnFail: 500 } },
      );
    }
    this.worker = new Worker(QUEUE_NAME, async (job) => this.run(job.name), {
      connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.name ?? '?'} failed: ${err.message}`),
    );
    this.logger.log(
      `Scheduled ${SCHEDULES.map((s) => `${s.id} (${s.pattern} ${s.tz})`).join(', ')}`,
    );
  }

  /** Runs one scheduled job by name. */
  async run(name: string) {
    switch (name) {
      case 'collections-daily':
        return this.collections.runDaily();
      case 'collections-notices':
        return this.collections.runNotices();
      default:
        throw new Error(`Unknown job ${name}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
