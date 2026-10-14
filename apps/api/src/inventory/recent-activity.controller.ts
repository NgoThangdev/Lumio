import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { RecentActivityService } from './recent-activity.service.js';

@Controller('api/households/:householdId/home/activity')
@UseGuards(SessionGuard)
export class RecentActivityController {
  constructor(private readonly activity: RecentActivityService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.activity.list(request.actorId, householdId);
  }
}
