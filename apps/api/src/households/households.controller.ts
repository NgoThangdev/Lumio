import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { HouseholdsService } from './households.service.js';

@Controller('api/households')
@UseGuards(SessionGuard)
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.households.list(request.actorId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: { name?: unknown },
  ) {
    return this.households.create(request.actorId, body?.name);
  }
}
