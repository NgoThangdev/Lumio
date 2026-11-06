export type HouseholdPurgeRunnerConfig = {
  executionEnabled: boolean;
  activationCutoff: Date | null;
  batchSize: number;
};

export type DueHouseholdDeletion = {
  householdId: string;
  requestId: string;
  requestedAt: Date;
  dueAt: Date;
};

export type HouseholdPurgeRunnerDependencies = {
  discover: (
    activationCutoff: Date | null,
    limit: number,
  ) => Promise<DueHouseholdDeletion[]>;
  dryRun: (
    householdId: string,
    requestId: string,
    activationCutoff: Date | null,
  ) => Promise<{
    due: boolean;
    eligible: boolean;
    reason: string | null;
    dueAt: Date | null;
  }>;
  execute: (
    householdId: string,
    requestId: string,
    activationCutoff: Date,
  ) => Promise<unknown>;
};

export type HouseholdPurgeRunnerRecord = {
  householdId: string;
  result: string;
};

export type HouseholdPurgeRunnerResult = {
  mode: 'dry-run' | 'execute';
  selected: number;
  succeeded: number;
  failed: number;
  records: HouseholdPurgeRunnerRecord[];
};

function parseActivationCutoff(value: string | undefined) {
  if (value === undefined || value === '') return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error('INVALID_HOUSEHOLD_PURGE_ACTIVATION_CUTOFF');
  return new Date(value);
}

export function parseHouseholdPurgeRunnerConfig(
  env: NodeJS.ProcessEnv,
): HouseholdPurgeRunnerConfig {
  const enableValue = env.HOUSEHOLD_PURGE_EXECUTION_ENABLED;
  if (
    enableValue !== undefined &&
    enableValue !== '' &&
    enableValue !== 'true' &&
    enableValue !== 'false'
  )
    throw new Error('INVALID_HOUSEHOLD_PURGE_EXECUTION_ENABLED');
  const executionEnabled = enableValue === 'true';
  const activationCutoff = parseActivationCutoff(
    env.HOUSEHOLD_PURGE_ACTIVATION_CUTOFF,
  );
  if (executionEnabled && !activationCutoff)
    throw new Error('HOUSEHOLD_PURGE_ACTIVATION_CUTOFF_REQUIRED');

  const rawBatchSize = env.HOUSEHOLD_PURGE_BATCH_SIZE ?? '25';
  if (!/^[1-9]\d*$/.test(rawBatchSize) || Number(rawBatchSize) > 100)
    throw new Error('INVALID_HOUSEHOLD_PURGE_BATCH_SIZE');
  return {
    executionEnabled,
    activationCutoff,
    batchSize: Number(rawBatchSize),
  };
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'PURGE_FAILED';
  const response = 'response' in error ? error.response : undefined;
  if (response && typeof response === 'object' && 'code' in response) {
    const code = response.code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
  }
  if ('message' in error && typeof error.message === 'string') {
    const message = error.message;
    if (/^[A-Z0-9_]+$/.test(message)) return message;
  }
  return 'PURGE_FAILED';
}

export async function runHouseholdPurgeBatch(
  config: HouseholdPurgeRunnerConfig,
  executeRequested: boolean,
  dependencies: HouseholdPurgeRunnerDependencies,
  writeRecord: (record: HouseholdPurgeRunnerRecord) => void = (record) =>
    console.log(JSON.stringify(record)),
): Promise<HouseholdPurgeRunnerResult> {
  const executing = executeRequested && config.executionEnabled;
  if (executeRequested && !executing)
    throw new Error('HOUSEHOLD_PURGE_EXECUTION_DISABLED');
  if (executing && !config.activationCutoff)
    throw new Error('HOUSEHOLD_PURGE_ACTIVATION_CUTOFF_REQUIRED');

  const candidates = (
    await dependencies.discover(config.activationCutoff, config.batchSize)
  ).slice(0, config.batchSize);
  const records: HouseholdPurgeRunnerRecord[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let result: string;
    try {
      if (executing) {
        await dependencies.execute(
          candidate.householdId,
          candidate.requestId,
          config.activationCutoff!,
        );
        result = 'PURGED';
      } else {
        const dryRun = await dependencies.dryRun(
          candidate.householdId,
          candidate.requestId,
          config.activationCutoff,
        );
        result = dryRun.eligible
          ? 'ELIGIBLE_DUE'
          : (dryRun.reason ?? 'NOT_ELIGIBLE');
      }
      succeeded += 1;
    } catch (error) {
      result = safeErrorCode(error);
      failed += 1;
    }
    const record = { householdId: candidate.householdId, result };
    records.push(record);
    writeRecord(record);
  }

  return {
    mode: executing ? 'execute' : 'dry-run',
    selected: candidates.length,
    succeeded,
    failed,
    records,
  };
}
