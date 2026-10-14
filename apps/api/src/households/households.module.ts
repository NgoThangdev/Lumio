import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { HouseholdsController } from './households.controller.js';
import { HouseholdsService } from './households.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [HouseholdsController],
  providers: [HouseholdsService],
})
export class HouseholdsModule {}
