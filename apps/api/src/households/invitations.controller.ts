import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { HouseholdsService } from './households.service.js';

@Controller('api/invitations')
export class InvitationsController {
  constructor(private readonly households: HouseholdsService) {}

  @Get(':secret')
  preview(@Param('secret') secret: string) {
    return this.households.previewInvitation(secret);
  }

  @Post(':secret/accept')
  @UseGuards(SessionGuard)
  accept(
    @Req() request: AuthenticatedRequest,
    @Param('secret') secret: string,
  ) {
    return this.households.acceptInvitation(request.actorId, secret);
  }
}
