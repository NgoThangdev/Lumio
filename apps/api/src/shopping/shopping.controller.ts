import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { ShoppingService } from './shopping.service.js';
import { StockCheckService } from './stock-check.service.js';

@Controller('api/households/:householdId/trips')
@UseGuards(SessionGuard)
export class ShoppingController {
  constructor(
    private readonly shopping: ShoppingService,
    private readonly stockCheck: StockCheckService,
  ) {}

  @Get(':tripId/stock-check')
  checkList(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.stockCheck.list(request.actorId, householdId, tripId);
  }

  @Put(':tripId/stock-check/:itemId')
  saveCheck(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.stockCheck.save(
      request.actorId,
      householdId,
      tripId,
      itemId,
      body ?? {},
    );
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.shopping.list(request.actorId, householdId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: { store?: unknown; plannedDate?: unknown },
  ) {
    return this.shopping.create(
      request.actorId,
      householdId,
      body?.store,
      body?.plannedDate,
    );
  }

  @Get(':tripId')
  read(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.shopping.read(request.actorId, householdId, tripId);
  }

  @Post(':tripId/suggestions')
  importSuggestions(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.shopping.importSuggestions(
      request.actorId,
      householdId,
      tripId,
    );
  }

  @Post(':tripId/entries')
  addManual(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
    @Body() body: { itemId?: unknown },
  ) {
    return this.shopping.addManual(
      request.actorId,
      householdId,
      tripId,
      body?.itemId,
    );
  }

  @Post(':tripId/start')
  start(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.shopping.start(request.actorId, householdId, tripId);
  }

  @Patch(':tripId/entries/:entryId')
  decideEntry(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
    @Param('entryId') entryId: string,
    @Body()
    body: {
      status?: unknown;
      actualQuantity?: unknown;
      expiryDate?: unknown;
      locationId?: unknown;
      destinationTripId?: unknown;
    },
  ) {
    return this.shopping.decideEntry(
      request.actorId,
      householdId,
      tripId,
      entryId,
      body?.status,
      body?.actualQuantity,
      body?.expiryDate,
      body?.locationId,
      body?.destinationTripId,
    );
  }

  @Post(':tripId/finish')
  finish(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.shopping.finish(request.actorId, householdId, tripId);
  }
}
