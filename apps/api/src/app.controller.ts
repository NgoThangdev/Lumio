import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);
  private readinessProbeLogged = false;
  private readinessFailureLogged = false;

  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('api/ready')
  async getReadiness(): Promise<{ status: 'ok' }> {
    if (!this.readinessProbeLogged) {
      this.logger.log('Readiness probe received');
      this.readinessProbeLogged = true;
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (error) {
      if (!this.readinessFailureLogged) {
        const failure = error as {
          code?: string;
          meta?: { driverAdapterError?: { cause?: { kind?: string } } };
        } | null;
        this.logger.error(
          `Readiness database query failed: prismaCode=${failure?.code ?? 'unknown'}, driverKind=${failure?.meta?.driverAdapterError?.cause?.kind ?? 'unknown'}`,
        );
        this.readinessFailureLogged = true;
      }
      throw new ServiceUnavailableException('Service unavailable');
    }
  }
}
