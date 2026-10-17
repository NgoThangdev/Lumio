import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { addCalendarDays } from '../src/inventory/stock-intelligence.js';
import { localCalendarDate } from '../src/inventory/plan-use.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Current household attention HTTP (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userIds: string[];
  let householdIds: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => {
    userIds = [];
    householdIds = [];
  });
  afterEach(async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    await prisma.stockBatch.deleteMany({
      where: { itemId: { in: items.map((item) => item.id) } },
    });
    await prisma.inventoryItem.deleteMany({
      where: { id: { in: items.map((item) => item.id) } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => app.close());

  async function register() {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `${randomUUID()}@example.invalid`,
        password: 'fixture-password-123',
      })
      .expect(201);
    userIds.push(response.body.id as string);
    return {
      id: response.body.id as string,
      cookie: (response.headers['set-cookie'] as string[])[0].split(';')[0],
    };
  }

  async function household(name: string, userId: string) {
    const row = await prisma.household.create({ data: { name } });
    householdIds.push(row.id);
    await prisma.membership.create({
      data: { userId, householdId: row.id, role: 'MEMBER' },
    });
    return row.id;
  }

  async function item(
    householdId: string,
    name: string,
    lowStockThreshold?: string,
  ) {
    return prisma.inventoryItem.create({
      data: { householdId, name, primaryUnit: 'box', lowStockThreshold },
    });
  }

  it('groups live low-stock and Use Soon items across active households only', async () => {
    const alice = await register();
    const bob = await register();
    const home = await household('Home', alice.id);
    const cabin = await household('Cabin', alice.id);
    const privateHome = await household('Private', bob.id);
    const low = await item(home, 'Low', '2');
    const soon = await item(home, 'Soon');
    const cabinItem = await item(cabin, 'Cabin item');
    const secret = await item(privateHome, 'Secret');
    const today = localCalendarDate(new Date());
    await prisma.stockBatch.createMany({
      data: [
        { itemId: low.id, quantity: '1' },
        {
          itemId: soon.id,
          quantity: '1',
          expiryDate: new Date(`${addCalendarDays(today, 2)}T00:00:00.000Z`),
        },
      ],
    });

    const url = '/api/me/attention';
    await request(app.getHttpServer()).get(url).expect(401);
    const first = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', alice.cookie)
      .expect(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(new Date(first.body.asOf as string).toString()).not.toBe(
      'Invalid Date',
    );
    expect(first.body.households).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          householdId: home,
          name: 'Home',
          items: expect.arrayContaining([
            expect.objectContaining({
              itemId: low.id,
              name: 'Low',
              trackingMode: 'QUANTITY',
              signals: ['LOW_STOCK'],
              lowStockRisk: 'LOW',
            }),
            expect.objectContaining({
              itemId: soon.id,
              name: 'Soon',
              signals: ['USE_SOON'],
              expiryRisk: 'USE_SOON',
            }),
          ]),
        }),
        expect.objectContaining({
          householdId: cabin,
          name: 'Cabin',
          items: [expect.objectContaining({ itemId: cabinItem.id })],
        }),
      ]),
    );
    expect(first.body.households).toHaveLength(2);
    expect(JSON.stringify(first.body)).not.toContain(secret.id);
    expect(
      (
        await request(app.getHttpServer())
          .get(url)
          .set('Cookie', bob.cookie)
          .expect(200)
      ).body.households,
    ).toEqual([expect.objectContaining({ householdId: privateHome })]);

    await prisma.stockBatch.create({ data: { itemId: low.id, quantity: '2' } });
    await prisma.stockBatch.updateMany({
      where: { itemId: soon.id },
      data: {
        expiryDate: new Date(`${addCalendarDays(today, 20)}T00:00:00.000Z`),
      },
    });
    const changed = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', alice.cookie)
      .expect(200);
    expect(changed.body.households).toEqual([
      expect.objectContaining({
        householdId: cabin,
        items: [expect.objectContaining({ itemId: cabinItem.id })],
      }),
    ]);

    await prisma.membership.delete({
      where: { userId_householdId: { userId: alice.id, householdId: cabin } },
    });
    const removed = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', alice.cookie)
      .expect(200);
    expect(removed.body.households).toEqual([]);
  });
});
