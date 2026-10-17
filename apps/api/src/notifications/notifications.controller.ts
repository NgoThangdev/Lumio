import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationEvaluatorService } from './notification-evaluator.service.js';
import { WebPushConfiguration } from './web-push-transport.service.js';

@Controller('api/me')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly webPush: WebPushConfiguration,
    private readonly evaluator: NotificationEvaluatorService,
  ) {}

  @Get('attention')
  @Header('Cache-Control', 'no-store')
  attention(@Req() request: AuthenticatedRequest) {
    return this.evaluator.attention(request.actorId);
  }

  @Get('push-public-key')
  @Header('Cache-Control', 'no-store')
  pushPublicKey() {
    return this.webPush.publicState();
  }

  @Get('notification-preferences')
  preferences(@Req() request: AuthenticatedRequest) {
    return this.notifications.preferences(request.actorId);
  }

  @Patch('notification-preferences')
  updatePreferences(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.notifications.updatePreferences(request.actorId, body);
  }

  @Put('push-subscription')
  register(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notifications.register(
      request.actorId,
      request.sessionToken,
      body,
    );
  }

  @Post('push-subscription/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  status(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notifications.status(request.sessionToken, body);
  }

  @Delete('push-subscription')
  remove(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notifications.remove(request.sessionToken, body);
  }
}
