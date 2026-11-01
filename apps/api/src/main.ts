import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { NotificationSchedulerService } from './notifications/notification-scheduler.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  await app.listen(port, host);
  Logger.log(`HTTP listening on ${host}:${port}`, 'Bootstrap');
  app.get(NotificationSchedulerService).start();
}
await bootstrap();
