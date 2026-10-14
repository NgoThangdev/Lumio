import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ShoppingController } from './shopping.controller.js';
import { ShoppingService } from './shopping.service.js';
import { StockCheckService } from './stock-check.service.js';

@Module({
  imports: [AuthModule, InventoryModule, PrismaModule],
  controllers: [ShoppingController],
  providers: [ShoppingService, StockCheckService],
})
export class ShoppingModule {}
