import {
  NotificationSchedulerService,
  parseNotificationSchedulerConfig,
  type NotificationSchedulerConfig,
} from './notification-scheduler.service.js';

const cutoff = new Date('2026-10-15T00:00:00.000Z');
const enabled: NotificationSchedulerConfig = {
  enabled: true,
  digestMinute: 9 * 60,
  activationCutoff: cutoff,
  urgentIntervalMinutes: 5,
};

function setup(config: NotificationSchedulerConfig = enabled) {
  const evaluator = {
    evaluateEligibleUsers: vi.fn().mockResolvedValue(undefined),
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

  it('is disabled by default even if VAPID exists and schedules nothing on startup', async () => {
    expect(
      parseNotificationSchedulerConfig({ VAPID_PRIVATE_KEY: 'configured' }),
    ).toEqual({ enabled: false });
    vi.useFakeTimers();
    const { scheduler, evaluator, dispatcher } = setup({ enabled: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await scheduler.tick(new Date('2026-10-15T02:00:00.000Z'));
    expect(evaluator.evaluateEligibleUsers).not.toHaveBeenCalled();
    expect(dispatcher.dispatchDue).not.toHaveBeenCalled();
    scheduler.onApplicationShutdown();
  });

  it('waits for the first real timer tick and the configured local digest minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T01:58:00.000Z')); // 08:58 local
    const { scheduler, evaluator, dispatcher } = setup();
    scheduler.start();
    expect(evaluator.evaluateEligibleUsers).not.toHaveBeenCalled();
    expect(dispatcher.dispatchDue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(evaluator.evaluateEligibleUsers.mock.calls).toEqual([
      [new Date('2026-10-15T01:59:00.000Z'), 'IMMEDIATE_ITEM'],
    ]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(evaluator.evaluateEligibleUsers).toHaveBeenCalledWith(
      new Date('2026-10-15T02:00:00.000Z'),
      'DAILY_DIGEST',
    );
    scheduler.onApplicationShutdown();
  });

  it('requires explicit valid digest time and activation cutoff before enablement', () => {
    expect(() =>
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
      }),
    ).toThrow('INVALID_NOTIFICATION_DIGEST_TIME');
    expect(() =>
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
        NOTIFICATION_DIGEST_TIME: '25:00',
        NOTIFICATION_ACTIVATION_CUTOFF: cutoff.toISOString(),
      }),
    ).toThrow('INVALID_NOTIFICATION_DIGEST_TIME');
    expect(() =>
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
        NOTIFICATION_DIGEST_TIME: '09:00',
      }),
    ).toThrow('INVALID_NOTIFICATION_ACTIVATION_CUTOFF');
    expect(
      parseNotificationSchedulerConfig({
        NOTIFICATION_AUTOMATION_ENABLED: 'true',
        NOTIFICATION_DIGEST_TIME: '09:00',
        NOTIFICATION_ACTIVATION_CUTOFF: cutoff.toISOString(),
      }),
    ).toEqual(enabled);
  });

  it('evaluates urgent candidates on its cadence without creating an early digest', async () => {
    const { scheduler, evaluator, dispatcher } = setup();
    const before = new Date('2026-10-15T01:00:00.000Z'); // 08:00 local
    await scheduler.tick(before);
    await scheduler.tick(new Date(before.getTime() + 60_000));
    await scheduler.tick(new Date(before.getTime() + 5 * 60_000));
    expect(evaluator.evaluateEligibleUsers.mock.calls).toEqual([
      [before, 'IMMEDIATE_ITEM'],
      [new Date(before.getTime() + 5 * 60_000), 'IMMEDIATE_ITEM'],
    ]);
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(3);
    expect(dispatcher.dispatchDue).toHaveBeenCalledWith(before, cutoff);
  });

  it('runs digest once per Ho Chi Minh local day and crosses the UTC day boundary', async () => {
    const { scheduler, evaluator } = setup();
    const before = new Date('2026-10-15T01:59:00.000Z'); // 08:59 local
    const due = new Date('2026-10-15T02:00:00.000Z'); // 09:00 local
    await scheduler.tick(before);
    await scheduler.tick(due);
    await scheduler.tick(new Date('2026-10-15T16:59:00.000Z')); // 23:59 local
    await scheduler.tick(new Date('2026-10-15T17:01:00.000Z')); // 00:01 next day
    await scheduler.tick(new Date('2026-10-16T02:00:00.000Z'));
    expect(
      evaluator.evaluateEligibleUsers.mock.calls.filter(
        ([, kind]) => kind === 'DAILY_DIGEST',
      ),
    ).toEqual([
      [due, 'DAILY_DIGEST'],
      [new Date('2026-10-16T02:00:00.000Z'), 'DAILY_DIGEST'],
    ]);
  });

  it('passes quiet-hour evaluation to the existing rules and retries deferred due intents', async () => {
    const { scheduler, evaluator, dispatcher } = setup({
      ...enabled,
      digestMinute: 23 * 60,
    });
    const quiet = new Date('2026-10-15T16:00:00.000Z'); // 23:00 local
    const release = new Date('2026-10-16T00:00:00.000Z'); // 07:00 local
    await scheduler.tick(quiet);
    await scheduler.tick(release);
    expect(evaluator.evaluateEligibleUsers).toHaveBeenCalledWith(
      quiet,
      'DAILY_DIGEST',
    );
    expect(dispatcher.dispatchDue).toHaveBeenCalledWith(release, cutoff);
  });

  it('does not overlap ticks and uses database idempotency again after restart', async () => {
    const { scheduler, evaluator, dispatcher } = setup();
    const due = new Date('2026-10-15T02:00:00.000Z');
    let release!: () => void;
    evaluator.evaluateEligibleUsers.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = scheduler.tick(due);
    await scheduler.tick(due);
    expect(evaluator.evaluateEligibleUsers).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(1);
    const restarted = setup();
    await restarted.scheduler.tick(due);
    expect(restarted.evaluator.evaluateEligibleUsers).toHaveBeenCalledWith(
      due,
      'DAILY_DIGEST',
    );
    expect(restarted.dispatcher.dispatchDue).toHaveBeenCalledWith(due, cutoff);
  });

  it('allows concurrent instances to converge on shared intent and delivery claims', async () => {
    const due = new Date('2026-10-15T02:00:00.000Z');
    const intentKeys = new Set<string>();
    const deliveryClaims = new Set<string>();
    const evaluator = {
      evaluateEligibleUsers: vi.fn(async (at: Date, kind: string) => {
        intentKeys.add(`${at.toISOString().slice(0, 10)}:${kind}`);
      }),
    };
    const dispatcher = {
      dispatchDue: vi.fn(async () => {
        deliveryClaims.add('intent:device');
      }),
    };
    const first = new NotificationSchedulerService(
      evaluator as never,
      dispatcher as never,
      enabled,
    );
    const second = new NotificationSchedulerService(
      evaluator as never,
      dispatcher as never,
      enabled,
    );
    await Promise.all([first.tick(due), second.tick(due)]);
    expect(evaluator.evaluateEligibleUsers).toHaveBeenCalledTimes(4);
    expect(dispatcher.dispatchDue).toHaveBeenCalledTimes(2);
    expect(intentKeys.size).toBe(2);
    expect(deliveryClaims.size).toBe(1);
  });

  it('does nothing before the explicit activation cutoff', async () => {
    const { scheduler, evaluator, dispatcher } = setup();
    await scheduler.tick(new Date(cutoff.getTime() - 1));
    expect(evaluator.evaluateEligibleUsers).not.toHaveBeenCalled();
    expect(dispatcher.dispatchDue).not.toHaveBeenCalled();
  });
});
