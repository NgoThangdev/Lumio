import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';
import { NotificationDispatchService } from './notification-dispatch.service.js';
import {
  NOTIFICATION_SCHEDULER_CONFIG,
  NotificationSchedulerService,
  notificationSchedulerConfigFromEnvironment,
} from './notification-scheduler.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import {
  WebPushConfiguration,
  WebPushTransport,
  webPushClientProvider,
} from './web-push-transport.service.js';

@Module({
  imports: [AuthModule, PrismaModule, InventoryModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationEvaluatorService,
    NotificationDispatchService,
    NotificationSchedulerService,
    {
      provide: NOTIFICATION_SCHEDULER_CONFIG,
      useFactory: notificationSchedulerConfigFromEnvironment,
    },
    WebPushConfiguration,
    webPushClientProvider,
    { provide: 'PUSH_TRANSPORT', useClass: WebPushTransport },
  ],
})
export class NotificationsModule {}
