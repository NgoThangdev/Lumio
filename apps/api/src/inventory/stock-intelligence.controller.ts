import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { StockIntelligenceService } from './stock-intelligence.service.js';

@Controller('api/households/:householdId/stock-intelligence')
@UseGuards(SessionGuard)
export class StockIntelligenceController {
  constructor(private readonly intelligence: StockIntelligenceService) {}

  @Get()
  assess(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Query('shoppingDate') shoppingDate?: string,
  ) {
    return this.intelligence.assessHousehold(
      request.actorId,
      householdId,
      shoppingDate,
    );
  }
}
