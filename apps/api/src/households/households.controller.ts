import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { HouseholdsService } from './households.service.js';

@Controller('api/households')
@UseGuards(SessionGuard)
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  @Get('pending-deletions')
  pendingDeletions(@Req() request: AuthenticatedRequest) {
    return this.households.pendingDeletions(request.actorId);
  }

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

  @Patch(':householdId')
  rename(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: unknown,
  ) {
    return this.households.rename(request.actorId, householdId, body);
  }

  @Delete(':householdId')
  deleteImmediately(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: unknown,
  ) {
    return this.households.deleteImmediately(
      request.actorId,
      householdId,
      body,
    );
  }

  @Get(':householdId/deletion-impact')
  deletionImpact(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.deletionImpactForAdmin(request.actorId, householdId);
  }

  @Post(':householdId/deletion-request')
  scheduleDeletion(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: unknown,
  ) {
    return this.households.scheduleDeletion(request.actorId, householdId, body);
  }

  @Delete(':householdId/deletion-request/:requestId')
  cancelDeletion(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.households.cancelDeletion(
      request.actorId,
      householdId,
      requestId,
    );
  }

  @Get(':householdId/shopping-settings')
  shoppingSettings(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.shoppingSettings(request.actorId, householdId);
  }

  @Get(':householdId/inventory-defaults')
  inventoryDefaults(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.inventoryDefaults(request.actorId, householdId);
  }

  @Patch(':householdId/inventory-defaults')
  updateInventoryDefaults(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: unknown,
  ) {
    return this.households.updateInventoryDefaults(
      request.actorId,
      householdId,
      body,
    );
  }

  @Patch(':householdId/shopping-settings')
  updateShoppingSettings(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: unknown,
  ) {
    return this.households.updateShoppingSettings(
      request.actorId,
      householdId,
      body,
    );
  }

  @Post(':householdId/invitations')
  invite(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.createInvitation(request.actorId, householdId);
  }

  @Get(':householdId/invitations')
  invitations(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.invitations(request.actorId, householdId);
  }

  @Delete(':householdId/invitations/:invitationId')
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.households.revokeInvitation(
      request.actorId,
      householdId,
      invitationId,
    );
  }

  @Get(':householdId/members')
  members(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.households.members(request.actorId, householdId);
  }

  @Delete(':householdId/members/:userId')
  removeMember(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('userId') userId: string,
  ) {
    return this.households.removeMember(request.actorId, householdId, userId);
  }
}
