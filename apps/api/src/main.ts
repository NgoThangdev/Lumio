import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { NotificationSchedulerService } from './notifications/notification-scheduler.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`HTTP listening on 0.0.0.0:${port}`, 'Bootstrap');
  app.get(NotificationSchedulerService).start();
}
await bootstrap();
