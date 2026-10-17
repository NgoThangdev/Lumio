import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';

function argument(name: string) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith('--'))
    throw new Error(`MISSING_${name.slice(2).toUpperCase().replace('-', '_')}`);
  return value;
}

async function main() {
  const userId = argument('--user-id');
  const intentId = argument('--intent-id');
  const flags = process.argv.slice(2).filter((value) => value.startsWith('--'));
  if (
    flags.some((flag) => !['--user-id', '--intent-id', '--send'].includes(flag))
  )
    throw new Error('UNKNOWN_ARGUMENT');
  const send = flags.includes('--send');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  try {
    const dispatcher = app.get(NotificationDispatchService);
    const preflight = await dispatcher.preflightIntent(userId, intentId);
    process.stdout.write(`${JSON.stringify(preflight)}\n`);
    if (!preflight.eligible) {
      process.exitCode = 1;
      return;
    }
    if (send) {
      const result = await dispatcher.dispatchIntentForUser(userId, intentId);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  // Errors may contain service details. The manual command prints only a code.
  process.stderr.write('MANUAL_PUSH_SMOKE_FAILED\n');
  process.exitCode = 1;
});
