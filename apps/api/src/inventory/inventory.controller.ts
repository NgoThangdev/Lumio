import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Query,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { InventoryService } from './inventory.service.js';
import { InventoryStateService } from './inventory-state.service.js';
import { InventoryReadService } from './inventory-read.service.js';
import { InventoryUndoService } from './inventory-undo.service.js';

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} is required.`);
  }
  return value;
}

function expiryDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Expiry date must be YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Expiry date must be a valid calendar date.');
  }
  return date;
}

@Controller('api/households/:householdId/items')
@UseGuards(SessionGuard)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly state: InventoryStateService,
    private readonly readService: InventoryReadService,
    private readonly undoService: InventoryUndoService,
  ) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (Object.keys(query).length > 0) {
      return this.readService.inventory(request.actorId, householdId, query);
    }
    return this.inventory.listItems(request.actorId, householdId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body()
    body: Record<string, unknown>,
  ) {
    const stock = body?.initialStock;
    const initialStock =
      stock && typeof stock === 'object' && !Array.isArray(stock)
        ? {
            ...stock,
            ...(Object.hasOwn(stock, 'expiryDate')
              ? {
                  expiryDate: expiryDate(
                    (stock as Record<string, unknown>).expiryDate,
                  ),
                }
              : {}),
          }
        : stock;
    return this.inventory.createItem({
      actorId: request.actorId,
      householdId,
      name: requiredString(body?.name, 'Item name'),
      primaryUnit: requiredString(body?.primaryUnit, 'Primary unit'),
      trackingMode: body?.trackingMode as
        'QUANTITY' | 'FIVE_LEVEL' | 'PRESENCE_BACKUP' | undefined,
      categoryId: body?.categoryId,
      locationId: body?.locationId,
      tagIds: body?.tagIds,
      initialStock,
    });
  }

  @Get(':itemId')
  read(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventory.readItem({
      actorId: request.actorId,
      householdId,
      itemId,
    });
  }

  @Put(':itemId/config')
  configure(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.inventory.configureItem({
      actorId: request.actorId,
      householdId,
      itemId,
      minimumStock: body?.minimumStock,
      lowStockThreshold: body?.lowStockThreshold,
      buyThreshold: body?.buyThreshold,
      targetStock: body?.targetStock,
      neverRunOut: body?.neverRunOut,
      predictionEnabled: body?.predictionEnabled,
    });
  }

  @Post(':itemId/restock')
  restock(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body()
    body: { quantity?: unknown; expiryDate?: unknown; locationId?: unknown },
  ) {
    return this.inventory.restockQuantity({
      actorId: request.actorId,
      householdId,
      itemId,
      quantity: requiredString(body?.quantity, 'Quantity'),
      expiryDate: expiryDate(body?.expiryDate),
      locationId: body?.locationId,
    });
  }

  @Post(':itemId/use')
  use(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: { quantity?: unknown },
  ) {
    return this.inventory.useQuantity({
      actorId: request.actorId,
      householdId,
      itemId,
      quantity: requiredString(body?.quantity, 'Quantity'),
    });
  }

  @Post(':itemId/undo')
  undo(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: { actionKind?: unknown; actionId?: unknown },
  ) {
    return this.undoService.undo(
      request.actorId,
      householdId,
      itemId,
      body ?? {},
    );
  }

  @Put(':itemId/opening-config')
  configureOpening(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body()
    body: {
      enabled?: unknown;
      recommendedDaysAfterOpening?: unknown;
      packageCountConfirmed?: unknown;
    },
  ) {
    return this.inventory.configureOpening(
      request.actorId,
      householdId,
      itemId,
      body?.enabled,
      body?.recommendedDaysAfterOpening,
      body?.packageCountConfirmed,
    );
  }

  @Post(':itemId/open')
  openQuantity(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventory.openQuantity(request.actorId, householdId, itemId);
  }

  @Post(':itemId/finish-opened')
  finishOpened(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventory.finishOpened(request.actorId, householdId, itemId);
  }

  @Put(':itemId/state/config')
  configureState(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.state.configure(
      request.actorId,
      householdId,
      itemId,
      body?.lowAtLevel,
      body?.buyAtLevel,
      body?.neverRunOut,
    );
  }

  @Post(':itemId/state/level')
  updateLevel(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: { level?: unknown },
  ) {
    return this.state.transition(request.actorId, householdId, itemId, {
      type: 'UPDATE_LEVEL',
      level: body?.level,
    });
  }

  @Post(':itemId/state/backups')
  addBackups(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: { count?: unknown },
  ) {
    return this.state.transition(request.actorId, householdId, itemId, {
      type: 'ADD_BACKUP',
      count: body?.count,
    });
  }

  @Post(':itemId/state/open-refill')
  openRefill(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.state.transition(request.actorId, householdId, itemId, {
      type: 'OPEN_REFILL',
    });
  }

  @Post(':itemId/state/presence')
  setPresence(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('itemId') itemId: string,
    @Body() body: { present?: unknown },
  ) {
    return this.state.transition(request.actorId, householdId, itemId, {
      type: 'SET_PRESENCE',
      present: body?.present,
    });
  }
}
