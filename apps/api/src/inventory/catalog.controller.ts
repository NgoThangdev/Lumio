import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { CatalogService } from './catalog.service.js';

@Controller('api/households/:householdId')
@UseGuards(SessionGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  categories(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.catalog.list(request.actorId, householdId, 'categories');
  }

  @Post('categories')
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: { name?: unknown },
  ) {
    return this.catalog.create(
      request.actorId,
      householdId,
      'categories',
      body?.name,
    );
  }

  @Get('locations')
  locations(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.catalog.list(request.actorId, householdId, 'locations');
  }

  @Post('locations')
  createLocation(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: { name?: unknown },
  ) {
    return this.catalog.create(
      request.actorId,
      householdId,
      'locations',
      body?.name,
    );
  }

  @Get('tags')
  tags(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
  ) {
    return this.catalog.list(request.actorId, householdId, 'tags');
  }

  @Post('tags')
  createTag(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Body() body: { name?: unknown },
  ) {
    return this.catalog.create(
      request.actorId,
      householdId,
      'tags',
      body?.name,
    );
  }
}
