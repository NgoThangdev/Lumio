import {
  NotificationSchedulerService,
  parseNotificationSchedulerConfig,
  type NotificationSchedulerConfig,
} from './notification-scheduler.service.js';

const cutoff = new Date('2026-10-15T00:00:00.000Z');
const enabled: NotificationSchedulerConfig = {
  enabled: true,
  activationCutoff: cutoff,
  urgentIntervalMinutes: 5,
};

function setup(config: NotificationSchedulerConfig = enabled) {
  const evaluator = {
    evaluateEligibleUsers: vi.fn().mockResolvedValue(undefined),
    evaluateDueDigests: vi.fn().mockResolvedValue(undefined),
  };
  const dispatcher = {
    dispatchDue: vi.fn().mockResolvedValue({ accepted: 0 }),
  };
  const scheduler = new NotificationSchedulerService(
    evaluator as never,
    dispatcher as never,
    config,
  );
  return { scheduler, evaluator, dispatcher };
}

describe('Notification scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is disabled by default even with VAPID and starts no timer', async () => {
    expect(
      parseNotificationSchedulerConfig({ VAPID_PRIVATE_KEY: 'set' }),
    ).toEqual({ enabled: false });
    vi.useFakeTimers();
    const { scheduler, evaluator, dispatcher } = setup({ enabled: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await scheduler.tick(new Date('2026-10-15T02:00:00.000Z'));
    expect(evaluator.evaluateDueDigests).not.toHaveBeenCalled();
    expect(dispatcher.dispatchDue).not.toHaveBeenCalled();
    scheduler.onApplicationShutdown();
  });

  it('requires activation cutoff but no global digest time', () => {
    expect(() =>
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
      }),
    ).toThrow('INVALID_NOTIFICATION_ACTIVATION_CUTOFF');
    expect(
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
        NOTIFICATION_ACTIVATION_CUTOFF: cutoff.toISOString(),
      }),
    ).toEqual(enabled);
  });

  it('waits one minute to start, keeps urgent cadence, and delegates per-user due selection each tick', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:59:00.000Z'));
    const { scheduler, evaluator, dispatcher } = setup();
    scheduler.start();
    expect(evaluator.evaluateDueDigests).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(evaluator.evaluateDueDigests).toHaveBeenCalledWith(
      new Date('2026-10-15T01:00:00.000Z'),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(evaluator.evaluateDueDigests).toHaveBeenCalledTimes(2);
    expect(evaluator.evaluateEligibleUsers.mock.calls).toEqual([
      [new Date('2026-10-15T01:00:00.000Z'), 'IMMEDIATE_ITEM'],
    ]);
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(2);
    scheduler.onApplicationShutdown();
  });

  it('does not overlap ticks, but rechecks after restart and across the local day boundary', async () => {
    const { scheduler, evaluator, dispatcher } = setup();
    const at = new Date('2026-10-15T16:59:00.000Z');
    let release!: () => void;
    evaluator.evaluateDueDigests.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = scheduler.tick(at);
    await scheduler.tick(at);
    expect(evaluator.evaluateDueDigests).toHaveBeenCalledTimes(1);
    release();
    await first;
    await scheduler.tick(new Date('2026-10-15T17:01:00.000Z'));
    expect(evaluator.evaluateDueDigests).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(2);
    const restarted = setup();
    await restarted.scheduler.tick(at);
    expect(restarted.evaluator.evaluateDueDigests).toHaveBeenCalledWith(at);
  });

  it('allows concurrent instances to rely on durable intent and delivery claims', async () => {
    const at = new Date('2026-10-15T02:00:00.000Z');
    const evaluator = {
      evaluateEligibleUsers: vi.fn().mockResolvedValue(undefined),
      evaluateDueDigests: vi.fn().mockResolvedValue(undefined),
    };
    const dispatcher = { dispatchDue: vi.fn().mockResolvedValue(undefined) };
    const a = new NotificationSchedulerService(
      evaluator as never,
      dispatcher as never,
      enabled,
    );
    const b = new NotificationSchedulerService(
      evaluator as never,
      dispatcher as never,
      enabled,
    );
    await Promise.all([a.tick(at), b.tick(at)]);
    expect(evaluator.evaluateDueDigests).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(2);
  });

  it('does nothing before activation cutoff', async () => {
    const { scheduler, evaluator, dispatcher } = setup();
    await scheduler.tick(new Date(cutoff.getTime() - 1));
    expect(evaluator.evaluateDueDigests).not.toHaveBeenCalled();
    expect(dispatcher.dispatchDue).not.toHaveBeenCalled();
  });
});
