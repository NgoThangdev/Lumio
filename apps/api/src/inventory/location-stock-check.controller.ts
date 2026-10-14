import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { LocationStockCheckService } from './location-stock-check.service.js';

@Controller('api/households/:householdId/locations/:locationId/stock-check')
@UseGuards(SessionGuard)
export class LocationStockCheckController {
  constructor(private readonly checks: LocationStockCheckService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.checks.list(request.actorId, householdId, locationId);
  }

  @Put(':itemId')
  save(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('locationId') locationId: string,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.checks.save(
      request.actorId,
      householdId,
      locationId,
      itemId,
      body ?? {},
    );
  }
}
