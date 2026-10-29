import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HouseholdPurgeService } from './household-purge.service.js';
import {
  parseHouseholdPurgeRunnerConfig,
  runHouseholdPurgeBatch,
} from './household-purge-runner.js';

@Module({
  imports: [PrismaModule],
  providers: [HouseholdPurgeService],
})
class HouseholdPurgeRunnerModule {}

function parseArguments(args: string[]) {
  if (args.some((arg) => arg !== '--execute'))
    throw new Error('INVALID_HOUSEHOLD_PURGE_ARGUMENT');
  return args.includes('--execute');
}

async function main() {
  loadEnv({
    path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
    quiet: true,
  });
  const config = parseHouseholdPurgeRunnerConfig(process.env);
  const executeRequested = parseArguments(process.argv.slice(2));
  if (executeRequested && !config.executionEnabled)
    throw new Error('HOUSEHOLD_PURGE_EXECUTION_DISABLED');
  if (executeRequested && !config.activationCutoff)
    throw new Error('HOUSEHOLD_PURGE_ACTIVATION_CUTOFF_REQUIRED');

  const context = await NestFactory.createApplicationContext(
    HouseholdPurgeRunnerModule,
    { logger: false },
  );
  try {
    const purge = context.get(HouseholdPurgeService);
    const result = await runHouseholdPurgeBatch(config, executeRequested, {
      discover: (cutoff, limit) =>
        purge.findDueScheduledDeletions(cutoff, limit),
      dryRun: (householdId, requestId, cutoff) =>
        purge.dryRunScheduledDeletion(householdId, requestId, cutoff),
      execute: (householdId, requestId, cutoff) =>
        purge.executeScheduledDeletion(householdId, requestId, cutoff),
    });
    Logger.log(
      JSON.stringify({
        event: 'HOUSEHOLD_PURGE_RUN_COMPLETE',
        mode: result.mode,
        selected: result.selected,
        succeeded: result.succeeded,
        failed: result.failed,
      }),
      'HouseholdPurgeRunner',
    );
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? error.message
      : null;
  const code =
    typeof message === 'string' && /^[A-Z0-9_]+$/.test(message)
      ? message
      : 'HOUSEHOLD_PURGE_RUN_FAILED';
  console.error(JSON.stringify({ event: 'HOUSEHOLD_PURGE_RUN_FAILED', code }));
  process.exitCode = 1;
});
