import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { NotificationSchedulerService } from './notifications/notification-scheduler.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
  app.get(NotificationSchedulerService).start();
}
await bootstrap();
