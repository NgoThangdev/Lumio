import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { InventoryStateService } from './inventory-state.service.js';
import { StockIntelligenceController } from './stock-intelligence.controller.js';
import { StockIntelligenceService } from './stock-intelligence.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { InventoryReadService } from './inventory-read.service.js';
import { NeedsAttentionController } from './needs-attention.controller.js';
import { NeedsAttentionService } from './needs-attention.service.js';
import { InventoryUndoService } from './inventory-undo.service.js';
import { LocationStockCheckController } from './location-stock-check.controller.js';
import { LocationStockCheckService } from './location-stock-check.service.js';
import { RecentActivityController } from './recent-activity.controller.js';
import { RecentActivityService } from './recent-activity.service.js';
import { InventoryItemLifecycleService } from './inventory-item-lifecycle.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [
    InventoryController,
    StockIntelligenceController,
    CatalogController,
    NeedsAttentionController,
    LocationStockCheckController,
    RecentActivityController,
  ],
  providers: [
    InventoryService,
    InventoryItemLifecycleService,
    InventoryStateService,
    InventoryUndoService,
    LocationStockCheckService,
    StockIntelligenceService,
    CatalogService,
    InventoryReadService,
    NeedsAttentionService,
    RecentActivityService,
  ],
  exports: [InventoryService, InventoryStateService, StockIntelligenceService],
})
export class InventoryModule {}
