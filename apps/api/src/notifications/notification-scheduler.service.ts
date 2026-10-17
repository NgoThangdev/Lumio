import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { localCalendarDate } from '../inventory/plan-use.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';

export type NotificationSchedulerConfig =
  | { enabled: false }
  | {
      enabled: true;
      digestMinute: number;
      activationCutoff: Date;
      urgentIntervalMinutes: number;
    };

export const NOTIFICATION_SCHEDULER_CONFIG = 'NOTIFICATION_SCHEDULER_CONFIG';
const minuteMs = 60_000;

export function parseNotificationSchedulerConfig(
  env: NodeJS.ProcessEnv,
): NotificationSchedulerConfig {
  const enabled = env.NOTIFICATION_AUTOMATION_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false')
    return { enabled: false };
  if (enabled !== 'true')
    throw new Error('INVALID_NOTIFICATION_AUTOMATION_ENABLED');

  const digestTime = env.NOTIFICATION_DIGEST_TIME;
  if (!digestTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(digestTime))
    throw new Error('INVALID_NOTIFICATION_DIGEST_TIME');
  const cutoff = env.NOTIFICATION_ACTIVATION_CUTOFF;
  if (
    !cutoff ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cutoff) ||
    Number.isNaN(Date.parse(cutoff)) ||
    new Date(cutoff).toISOString() !== cutoff
  )
    throw new Error('INVALID_NOTIFICATION_ACTIVATION_CUTOFF');
  const interval = env.NOTIFICATION_URGENT_INTERVAL_MINUTES ?? '5';
  if (!/^[1-9]\d*$/.test(interval) || Number(interval) > 60)
    throw new Error('INVALID_NOTIFICATION_URGENT_INTERVAL');
  return {
    enabled: true,
    digestMinute:
      Number(digestTime.slice(0, 2)) * 60 + Number(digestTime.slice(3)),
    activationCutoff: new Date(cutoff),
    urgentIntervalMinutes: Number(interval),
  };
}

export function notificationSchedulerConfigFromEnvironment() {
  loadEnv({
    path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
    quiet: true,
  });
  return parseNotificationSchedulerConfig(process.env);
}

function localMinute(at: Date) {
  return (at.getUTCHours() * 60 + at.getUTCMinutes() + 7 * 60) % 1440;
}

@Injectable()
export class NotificationSchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastUrgentSlot: number | null = null;
  private lastDigestDay: string | null = null;

  constructor(
    private readonly evaluator: NotificationEvaluatorService,
    private readonly dispatcher: NotificationDispatchService,
    @Inject(NOTIFICATION_SCHEDULER_CONFIG)
    private readonly config: NotificationSchedulerConfig,
  ) {}

  start() {
    if (!this.config.enabled || this.timer) return;
    // No startup sweep. The first tick runs after one minute.
    this.timer = setInterval(() => {
      void this.tick().catch(() =>
        this.logger.error('NOTIFICATION_SCHEDULER_TICK_FAILED'),
      );
    }, minuteMs);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Internal clock boundary, exercised with fake time and transport in tests.
  async tick(at = new Date()) {
    if (
      !this.config.enabled ||
      at < this.config.activationCutoff ||
      this.running
    )
      return;
    this.running = true;
    try {
      const slot = Math.floor(
        at.getTime() / (this.config.urgentIntervalMinutes * minuteMs),
      );
      if (this.lastUrgentSlot !== slot) {
        await this.evaluator.evaluateEligibleUsers(at, 'IMMEDIATE_ITEM');
        this.lastUrgentSlot = slot;
      }
      const day = localCalendarDate(at);
      if (
        localMinute(at) >= this.config.digestMinute &&
        this.lastDigestDay !== day
      ) {
        await this.evaluator.evaluateEligibleUsers(at, 'DAILY_DIGEST');
        this.lastDigestDay = day;
      }
      await this.dispatcher.dispatchDue(at, this.config.activationCutoff);
    } finally {
      this.running = false;
    }
  }
}
