import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HouseholdsModule } from './households/households.module.js';
import { ShoppingModule } from './shopping/shopping.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HouseholdsModule,
    InventoryModule,
    ShoppingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
