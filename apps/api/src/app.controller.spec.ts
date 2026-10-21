import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    queryRaw.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('readiness', () => {
    it('reports ready after a database query succeeds', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ok',
      });
      expect(queryRaw).toHaveBeenCalledOnce();
    });

    it('returns 503 without exposing database error details', async () => {
      queryRaw.mockRejectedValue(new Error('private connection detail'));
      await expect(appController.getReadiness()).rejects.toMatchObject({
        status: 503,
        response: {
          message: 'Service unavailable',
        },
      });
    });
  });
});
