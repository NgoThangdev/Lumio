import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Shopping section mapping (database; requires migration)', () => {
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
    await prisma.category.deleteMany({
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
      .send({ name: 'Sections fixture' })
      .expect(201);
    const id = response.body.id as string;
    households.push(id);
    return id;
  }

  it('regroups current and historical trip reads without rewriting entries', async () => {
    const admin = await account();
    const member = await account();
    const otherAdmin = await account();
    const home = await household(admin.cookie);
    const other = await household(otherAdmin.cookie);
    await prisma.membership.create({
      data: { userId: member.id, householdId: home, role: 'MEMBER' },
    });
    const category = await request(app.getHttpServer())
      .post(`/api/households/${home}/categories`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Cold items' })
      .expect(201);
    expect(category.body.shoppingSection).toBeNull();
    const otherCategory = await request(app.getHttpServer())
      .post(`/api/households/${other}/categories`)
      .set('Cookie', otherAdmin.cookie)
      .send({ name: 'Cold items' })
      .expect(201);
    const item = await prisma.inventoryItem.create({
      data: {
        householdId: home,
        categoryId: category.body.id as string,
        name: 'Milk',
        primaryUnit: 'box',
      },
    });
    const uncategorized = await prisma.inventoryItem.create({
      data: { householdId: home, name: 'Unsorted', primaryUnit: 'piece' },
    });
    const trip = await prisma.shoppingTrip.create({
      data: {
        householdId: home,
        createdByUserId: admin.id,
        store: 'Market',
        plannedDate: new Date('2026-10-18T00:00:00.000Z'),
        status: 'SHOPPING',
      },
    });
    const entry = await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId: item.id,
        source: 'SUGGESTED',
        status: 'PURCHASED',
        priority: 'MUST_BUY',
        suggestedQuantity: 2,
        suggestedReason: 'Saved snapshot',
        actualQuantity: 3,
      },
    });
    await prisma.shoppingEntry.create({
      data: {
        tripId: trip.id,
        itemId: uncategorized.id,
        source: 'MANUAL',
        priority: 'OPTIONAL',
      },
    });
    const tripUrl = `/api/households/${home}/trips/${trip.id}`;
    const read = async () =>
      (
        await request(app.getHttpServer())
          .get(tripUrl)
          .set('Cookie', member.cookie)
          .expect(200)
      ).body;
    expect(
      (await read()).entries.map(
        (row: { shoppingSection: string }) => row.shoppingSection,
      ),
    ).toEqual(['OTHER', 'OTHER']);
    const patchUrl = `/api/households/${home}/categories/${category.body.id as string}`;
    await request(app.getHttpServer())
      .patch(patchUrl)
      .set('Cookie', member.cookie)
      .send({ shoppingSection: 'DAIRY' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(patchUrl)
      .set('Cookie', otherAdmin.cookie)
      .send({ shoppingSection: 'DAIRY' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(
        `/api/households/${other}/categories/${category.body.id as string}`,
      )
      .set('Cookie', otherAdmin.cookie)
      .send({ shoppingSection: 'DAIRY' })
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .patch(patchUrl)
          .set('Cookie', admin.cookie)
          .send({ shoppingSection: 'DAIRY' })
          .expect(200)
      ).body.shoppingSection,
    ).toBe('DAIRY');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/households/${home}/categories`)
          .set('Cookie', member.cookie)
          .expect(200)
      ).body[0].shoppingSection,
    ).toBe('DAIRY');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/households/${other}/categories`)
          .set('Cookie', otherAdmin.cookie)
          .expect(200)
      ).body[0].id,
    ).toBe(otherCategory.body.id);
    const current = await read();
    expect(
      current.entries.map(
        (row: { shoppingSection: string }) => row.shoppingSection,
      ),
    ).toEqual(['DAIRY', 'OTHER']);
    expect(current.entries[0]).toMatchObject({
      id: entry.id,
      priority: 'MUST_BUY',
      status: 'PURCHASED',
      suggestedReason: 'Saved snapshot',
      actualQuantity: '3',
    });
    await prisma.shoppingTrip.update({
      where: { id: trip.id },
      data: { status: 'RESTOCKED' },
    });
    await request(app.getHttpServer())
      .patch(patchUrl)
      .set('Cookie', admin.cookie)
      .send({ shoppingSection: 'DRINKS' })
      .expect(200);
    expect((await read()).entries[0].shoppingSection).toBe('DRINKS');
    const saved = await prisma.shoppingEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(saved.suggestedReason).toBe('Saved snapshot');
    expect(saved.suggestedQuantity.toString()).toBe('2');
    expect(saved.actualQuantity?.toString()).toBe('3');
  });
});
