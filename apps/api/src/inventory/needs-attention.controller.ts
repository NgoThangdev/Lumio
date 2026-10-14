import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { NeedsAttentionService } from './needs-attention.service.js';

@Controller('api/households/:householdId/home/needs-attention')
@UseGuards(SessionGuard)
export class NeedsAttentionController {
  constructor(private readonly needsAttention: NeedsAttentionService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.needsAttention.list(request.actorId, householdId);
  }
}
