import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Household shopping settings (database; requires migration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const users: string[] = [];
  const households: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await prisma.shoppingEntry.deleteMany({
      where: { trip: { householdId: { in: households } } },
    });
    await prisma.shoppingTrip.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.inventoryItem.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  });

  async function account() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    const id = response.body.id as string;
    users.push(id);
    return {
      id,
      cookie: (response.headers['set-cookie'] as string[])[0].split(';')[0],
    };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: 'Settings fixture' })
      .expect(201);
    const id = response.body.id as string;
    households.push(id);
    return id;
  }

  it('isolates Admin updates and preserves planned trips and imported suggestion snapshots', async () => {
    const admin = await account();
    const member = await account();
    const outsider = await account();
    const home = await household(admin.cookie);
    const other = await household(outsider.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const item = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Rice', primaryUnit: 'box' },
    });
    const plannedDate = new Date('2026-11-01T00:00:00.000Z');
    const importedAt = new Date('2026-10-17T00:00:00.000Z');
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId: home,
        createdByUserId: admin.id,
        store: 'Original store',
        plannedDate,
        suggestionsImportedAt: importedAt,
      },
    });
    const entry = await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId: item.id,
        source: 'SUGGESTED',
        priority: 'SHOULD_BUY',
        suggestedQuantity: 2,
        suggestedReason: 'Original snapshot',
      },
    });
    const url = `/api/households/${home}/shopping-settings`;
    await request(app.getHttpServer()).get(url).expect(401);
    expect(
      (
        await request(app.getHttpServer())
          .get(url)
          .set('Cookie', member.cookie)
          .expect(200)
      ).body,
    ).toEqual({ defaultShoppingCycleDays: 7, defaultStore: null });
    await request(app.getHttpServer())
      .get(url)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .patch(url)
      .set('Cookie', member.cookie)
      .send({ defaultShoppingCycleDays: 14 })
      .expect(403);
    await request(app.getHttpServer())
      .patch(url)
      .set('Cookie', outsider.cookie)
      .send({ defaultShoppingCycleDays: 14 })
      .expect(403);
    expect(
      (
        await request(app.getHttpServer())
          .patch(url)
          .set('Cookie', admin.cookie)
          .send({ defaultShoppingCycleDays: 14, defaultStore: ' Market ' })
          .expect(200)
      ).body,
    ).toEqual({ defaultShoppingCycleDays: 14, defaultStore: 'Market' });
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/households/${other}/shopping-settings`)
          .set('Cookie', outsider.cookie)
          .expect(200)
      ).body,
    ).toEqual({ defaultShoppingCycleDays: 7, defaultStore: null });
    const savedTrip = await prisma.shoppingTrip.findUniqueOrThrow({
      where: { id: trip.id },
    });
    const savedEntry = await prisma.shoppingEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(savedTrip.store).toBe('Original store');
    expect(savedTrip.plannedDate).toEqual(plannedDate);
    expect(savedTrip.suggestionsImportedAt).toEqual(importedAt);
    expect(savedEntry.suggestedQuantity?.toString()).toBe('2');
    expect(savedEntry.suggestedReason).toBe('Original snapshot');
  });
});
