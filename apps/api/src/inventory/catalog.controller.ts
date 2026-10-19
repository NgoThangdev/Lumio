import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
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

  @Patch('categories/:categoryId')
  updateCategorySection(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateCategory(
      request.actorId,
      householdId,
      categoryId,
      body,
    );
  }

  @Patch('categories/:categoryId/inventory-defaults')
  updateCategoryInventoryDefaults(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.updateCategoryInventoryDefaults(
      request.actorId,
      householdId,
      categoryId,
      body,
    );
  }

  @Delete('categories/:categoryId')
  @HttpCode(204)
  removeCategory(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.catalog.removeCategory(
      request.actorId,
      householdId,
      categoryId,
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

  @Patch('locations/:locationId')
  renameLocation(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.renameLocation(
      request.actorId,
      householdId,
      locationId,
      body,
    );
  }

  @Delete('locations/:locationId')
  @HttpCode(204)
  removeLocation(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('locationId') locationId: string,
  ) {
    return this.catalog.removeLocation(
      request.actorId,
      householdId,
      locationId,
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

  @Patch('tags/:tagId')
  renameTag(
    @Req() request: AuthenticatedRequest,
    @Param('householdId') householdId: string,
    @Param('tagId') tagId: string,
    @Body() body: unknown,
  ) {
    return this.catalog.renameTag(request.actorId, householdId, tagId, body);
  }
}
