import {
  parseHouseholdPurgeRunnerConfig,
  runHouseholdPurgeBatch,
  type DueHouseholdDeletion,
  type HouseholdPurgeRunnerDependencies,
} from './household-purge-runner.js';

const cutoff = new Date('2026-10-27T00:00:00.000Z');

function candidate(householdId: string): DueHouseholdDeletion {
  return {
    householdId,
    requestId: 'opaque-request-id',
    requestedAt: new Date('2026-10-27T01:00:00.000Z'),
    dueAt: new Date('2026-10-27T02:00:00.000Z'),
  };
}

function config(
  overrides: Partial<ReturnType<typeof parseHouseholdPurgeRunnerConfig>> = {},
) {
  return {
    executionEnabled: false,
    activationCutoff: null,
    batchSize: 25,
    ...overrides,
  };
}

function dependencies(
  candidates: DueHouseholdDeletion[],
  overrides: Partial<HouseholdPurgeRunnerDependencies> = {},
): HouseholdPurgeRunnerDependencies {
  return {
    discover: vi.fn().mockResolvedValue(candidates),
    dryRun: vi.fn().mockResolvedValue({
      due: true,
      eligible: true,
      reason: null,
      dueAt: candidate('unused').dueAt,
    }),
    execute: vi.fn().mockResolvedValue({ purged: true }),
    ...overrides,
  };
}

describe('household purge runner', () => {
  it('defaults to dry-run with a bounded batch and rejects enabled execution without a cutoff', () => {
    expect(parseHouseholdPurgeRunnerConfig({})).toEqual({
      executionEnabled: false,
      activationCutoff: null,
      batchSize: 25,
    });
    expect(() =>
      parseHouseholdPurgeRunnerConfig({
        HOUSEHOLD_PURGE_EXECUTION_ENABLED: 'true',
      }),
    ).toThrow('HOUSEHOLD_PURGE_ACTIVATION_CUTOFF_REQUIRED');
    expect(
      parseHouseholdPurgeRunnerConfig({
        HOUSEHOLD_PURGE_EXECUTION_ENABLED: 'true',
        HOUSEHOLD_PURGE_ACTIVATION_CUTOFF: cutoff.toISOString(),
        HOUSEHOLD_PURGE_BATCH_SIZE: '100',
      }),
    ).toMatchObject({
      executionEnabled: true,
      activationCutoff: cutoff,
      batchSize: 100,
    });
    expect(() =>
      parseHouseholdPurgeRunnerConfig({ HOUSEHOLD_PURGE_BATCH_SIZE: '101' }),
    ).toThrow('INVALID_HOUSEHOLD_PURGE_BATCH_SIZE');
  });

  it('runs dry-run by default, reports due and stale candidates, and never invokes execution', async () => {
    const deps = dependencies(
      [candidate('household-a'), candidate('household-b')],
      {
        dryRun: vi
          .fn()
          .mockResolvedValueOnce({
            due: true,
            eligible: true,
            reason: null,
            dueAt: candidate('a').dueAt,
          })
          .mockResolvedValueOnce({
            due: false,
            eligible: false,
            reason: 'HOUSEHOLD_DELETION_REQUEST_STALE',
            dueAt: null,
          }),
      },
    );
    const logs: unknown[] = [];
    const result = await runHouseholdPurgeBatch(
      config(),
      false,
      deps,
      (record) => logs.push(record),
    );
    expect(result).toMatchObject({
      mode: 'dry-run',
      selected: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(result.records).toEqual([
      { householdId: 'household-a', result: 'ELIGIBLE_DUE' },
      {
        householdId: 'household-b',
        result: 'HOUSEHOLD_DELETION_REQUEST_STALE',
      },
    ]);
    expect(deps.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain('opaque-request-id');
  });

  it('completes an empty dry-run without calling per-household operations', async () => {
    const deps = dependencies([]);
    const result = await runHouseholdPurgeBatch(
      config(),
      false,
      deps,
      () => undefined,
    );
    expect(result).toMatchObject({ mode: 'dry-run', selected: 0, failed: 0 });
    expect(deps.dryRun).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('refuses execution when the explicit environment enable flag is absent', async () => {
    const deps = dependencies([candidate('household-a')]);
    await expect(
      runHouseholdPurgeBatch(config(), true, deps, () => undefined),
    ).rejects.toThrow('HOUSEHOLD_PURGE_EXECUTION_DISABLED');
    expect(deps.discover).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('bounds candidate processing even if discovery returns too many rows', async () => {
    const deps = dependencies(
      ['a', 'b', 'c'].map((id) => candidate('household-' + id)),
    );
    const result = await runHouseholdPurgeBatch(
      config({ batchSize: 2 }),
      false,
      deps,
      () => undefined,
    );
    expect(deps.discover).toHaveBeenCalledWith(null, 2);
    expect(result.selected).toBe(2);
    expect(deps.dryRun).toHaveBeenCalledTimes(2);
  });

  it('continues after one household execution failure and returns a failing summary', async () => {
    const deps = dependencies(
      [candidate('household-a'), candidate('household-b')],
      {
        execute: vi
          .fn()
          .mockRejectedValueOnce(new Error('secret endpoint content'))
          .mockResolvedValueOnce({ purged: true }),
      },
    );
    const logs: unknown[] = [];
    const result = await runHouseholdPurgeBatch(
      config({ executionEnabled: true, activationCutoff: cutoff }),
      true,
      deps,
      (record) => logs.push(record),
    );
    expect(result).toMatchObject({
      mode: 'execute',
      selected: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(deps.execute).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logs)).not.toContain('secret endpoint content');
    expect(JSON.stringify(logs)).not.toContain('opaque-request-id');
  });

  it('passes each discovered request through execution so cancellation/replacement is rechecked', async () => {
    let currentRequest = 'request-a';
    const item = candidate('household-a');
    item.requestId = currentRequest;
    const deps = dependencies([item], {
      execute: vi.fn(async (_householdId: string, requestId: string) => {
        if (requestId !== currentRequest)
          throw Object.assign(new Error('stale'), {
            response: { code: 'HOUSEHOLD_DELETION_REQUEST_STALE' },
          });
      }),
    });
    currentRequest = 'request-replaced-after-discovery';
    const result = await runHouseholdPurgeBatch(
      config({ executionEnabled: true, activationCutoff: cutoff }),
      true,
      deps,
      () => undefined,
    );
    expect(result.records).toEqual([
      {
        householdId: 'household-a',
        result: 'HOUSEHOLD_DELETION_REQUEST_STALE',
      },
    ]);
    expect(result.failed).toBe(1);
  });

  it('allows repeated and concurrent runs to rely on the locked execution boundary', async () => {
    const remaining = new Set(['household-a']);
    const execute = vi.fn(async (householdId: string) => {
      if (!remaining.delete(householdId))
        throw Object.assign(new Error('gone'), {
          response: { code: 'HOUSEHOLD_NOT_FOUND' },
        });
      return { purged: true };
    });
    const item = candidate('household-a');
    const makeDeps = () => dependencies([item], { execute });
    const [first, second] = await Promise.all([
      runHouseholdPurgeBatch(
        config({ executionEnabled: true, activationCutoff: cutoff }),
        true,
        makeDeps(),
        () => undefined,
      ),
      runHouseholdPurgeBatch(
        config({ executionEnabled: true, activationCutoff: cutoff }),
        true,
        makeDeps(),
        () => undefined,
      ),
    ]);
    expect([first.succeeded, second.succeeded].sort((a, b) => a - b)).toEqual([
      0, 1,
    ]);
    expect([first.failed, second.failed].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
