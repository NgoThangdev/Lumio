import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Authenticated inventory HTTP flow (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let emails: string[];
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
    emails = [];
    householdIds = [];
  });

  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: { in: householdIds } },
      select: { id: true },
    });
    const itemIds = items.map((item) => item.id);
    const actions = await prisma.inventoryAction.findMany({
      where: { itemId: { in: itemIds } },
      select: { id: true },
    });
    await prisma.actionBatchAllocation.deleteMany({
      where: { actionId: { in: actions.map((action) => action.id) } },
    });
    await prisma.inventoryAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.inventoryStateAction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    await prisma.stockBatch.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.membership.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.location.deleteMany({
      where: { householdId: { in: householdIds } },
    });
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    expect(
      await prisma.household.count({ where: { id: { in: householdIds } } }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: userIds } } })).toBe(0);
  });

  afterAll(async () => app.close());

  async function register() {
    const email = `${randomUUID()}@example.invalid`;
    emails.push(email);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    const setCookie: string | string[] = response.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = header.split(';')[0];
    return {
      email,
      userId: response.body.id as string,
      cookie,
      setCookie: header,
    };
  }

  async function createHousehold(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: `HTTP fixture ${randomUUID()}` })
      .expect(201);
    const id = response.body.id as string;
    householdIds.push(id);
    return id;
  }

  async function createLocation(householdId: string) {
    return prisma.location.create({
      data: { householdId, name: 'Fixture shelf', nameKey: randomUUID() },
    });
  }

  it('stores a password hash and token hash, restores a session, signs out, and signs in', async () => {
    const account = await register();
    expect(account.setCookie).toContain('HttpOnly');
    expect(account.setCookie).toContain('SameSite=Lax');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: account.userId },
    });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain('fixture-password-123');
    const session = await prisma.userSession.findFirstOrThrow({
      where: { userId: account.userId },
    });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).not.toBe(account.cookie.split('=')[1]);
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', account.cookie)
      .expect(200, {
        id: account.userId,
        email: account.email,
      });
    await request(app.getHttpServer())
      .post('/api/auth/sign-out')
      .set('Cookie', account.cookie)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', account.cookie)
      .expect(401);
    const signIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({
        email: account.email,
        password: 'fixture-password-123',
      })
      .expect(201);
    expect(signIn.body.id).toBe(account.userId);
    await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({
        email: account.email,
        password: 'wrong-password',
      })
      .expect(401);
  });

  it('creates a household and completes create → restock → FEFO Use → read', async () => {
    const account = await register();
    const householdId = await createHousehold(account.cookie);
    const households = await request(app.getHttpServer())
      .get('/api/households')
      .set('Cookie', account.cookie)
      .expect(200);
    expect(households.body).toContainEqual(
      expect.objectContaining({ id: householdId, role: 'ADMIN' }),
    );
    const base = `/api/households/${householdId}/items`;
    const created = await request(app.getHttpServer())
      .post(base)
      .set('Cookie', account.cookie)
      .send({ name: 'Rice', primaryUnit: 'kg', actorId: randomUUID() })
      .expect(201);
    const itemId = created.body.id as string;
    const location = await createLocation(householdId);
    const later = await request(app.getHttpServer())
      .post(`${base}/${itemId}/restock`)
      .set('Cookie', account.cookie)
      .send({
        quantity: '4',
        expiryDate: '2099-02-01',
        locationId: location.id,
      })
      .expect(201);
    const earlier = await request(app.getHttpServer())
      .post(`${base}/${itemId}/restock`)
      .set('Cookie', account.cookie)
      .send({ quantity: '2.500001', expiryDate: '2099-01-01' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/use`)
      .set('Cookie', account.cookie)
      .send({ quantity: '3', actorId: randomUUID() })
      .expect(201);
    const detail = await request(app.getHttpServer())
      .get(`${base}/${itemId}`)
      .set('Cookie', account.cookie)
      .expect(200);
    expect(
      new Map(
        detail.body.batches.map((batch: { id: string; quantity: string }) => [
          batch.id,
          batch.quantity,
        ]),
      ),
    ).toEqual(
      new Map([
        [earlier.body.batch.id, '0'],
        [later.body.batch.id, '3.500001'],
      ]),
    );
    expect(detail.body.actions).toHaveLength(3);
    expect(
      detail.body.actions.every(
        (action: { userId: string }) => action.userId === account.userId,
      ),
    ).toBe(true);
    const use = detail.body.actions.find(
      (action: { type: string }) => action.type === 'USE',
    );
    expect(
      new Map(
        use.allocations.map(
          (allocation: { batchId: string; quantity: string }) => [
            allocation.batchId,
            allocation.quantity,
          ],
        ),
      ),
    ).toEqual(
      new Map([
        [earlier.body.batch.id, '2.500001'],
        [later.body.batch.id, '0.499999'],
      ]),
    );
    const listing = await request(app.getHttpServer())
      .get(base)
      .set('Cookie', account.cookie)
      .expect(200);
    expect(Array.isArray(listing.body)).toBe(true);
    expect(listing.body[0].batches).toHaveLength(2);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/use`)
      .set('Cookie', account.cookie)
      .send({ quantity: '4' })
      .expect(409);
    const unchanged = await request(app.getHttpServer())
      .get(`${base}/${itemId}`)
      .set('Cookie', account.cookie)
      .expect(200);
    expect(unchanged.body.batches).toEqual(detail.body.batches);
    expect(unchanged.body.actions).toEqual(detail.body.actions);
  });

  it('denies all household inventory operations to a different signed-in user', async () => {
    const owner = await register();
    const outsider = await register();
    const householdId = await createHousehold(owner.cookie);
    const base = `/api/households/${householdId}/items`;
    const created = await request(app.getHttpServer())
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Rice', primaryUnit: 'kg' })
      .expect(201);
    const itemId = created.body.id as string;
    await request(app.getHttpServer())
      .get(base)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(base)
      .set('Cookie', outsider.cookie)
      .send({ name: 'Milk', primaryUnit: 'bottle' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/${itemId}`)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/restock`)
      .set('Cookie', outsider.cookie)
      .send({ quantity: '1' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/use`)
      .set('Cookie', outsider.cookie)
      .send({ quantity: '1' })
      .expect(403);
    expect(await prisma.inventoryAction.count({ where: { itemId } })).toBe(0);
    expect(await prisma.stockBatch.count({ where: { itemId } })).toBe(0);
  });

  it('serves authenticated five-level actions and household-scoped assessment', async () => {
    const owner = await register();
    const outsider = await register();
    const householdId = await createHousehold(owner.cookie);
    const base = `/api/households/${householdId}/items`;
    const created = await request(app.getHttpServer())
      .post(base)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Detergent',
        primaryUnit: 'bottle',
        trackingMode: 'FIVE_LEVEL',
      })
      .expect(201);
    const itemId = created.body.id as string;
    expect(created.body).toMatchObject({
      trackingMode: 'FIVE_LEVEL',
      currentLevel: 'EMPTY',
      backupCount: 0,
    });
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/state/level`)
      .set('Cookie', outsider.cookie)
      .send({ level: 'QUARTER' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/state/level`)
      .set('Cookie', owner.cookie)
      .send({ level: 'QUARTER' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/state/backups`)
      .set('Cookie', owner.cookie)
      .send({ count: 2 })
      .expect(201);
    const assessed = await request(app.getHttpServer())
      .get(`/api/households/${householdId}/stock-intelligence`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(assessed.body.assessments[0]).toMatchObject({
      itemId,
      lowStockRisk: 'OK',
      backupCount: 2,
      suggestion: null,
    });
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/restock`)
      .set('Cookie', owner.cookie)
      .send({ quantity: '1' })
      .expect(400);
    const detail = await request(app.getHttpServer())
      .get(`${base}/${itemId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(detail.body.stateActions).toHaveLength(2);
    expect(detail.body.batches).toHaveLength(0);
    expect(detail.body.actions).toHaveLength(0);
    expect(
      detail.body.stateActions.every(
        (action: { userId: string }) => action.userId === owner.userId,
      ),
    ).toBe(true);
  });

  it('keeps stock intelligence household-scoped and excludes RESTOCK from consumption', async () => {
    const owner = await register();
    const other = await register();
    const householdId = await createHousehold(owner.cookie);
    const base = `/api/households/${householdId}/items`;
    const created = await request(app.getHttpServer())
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Eggs', primaryUnit: 'egg' })
      .expect(201);
    const itemId = created.body.id as string;
    const settings = {
      minimumStock: '1',
      buyThreshold: '5',
      lowStockThreshold: '6',
      targetStock: '24',
      neverRunOut: true,
      predictionEnabled: true,
    };
    await request(app.getHttpServer())
      .put(`${base}/${itemId}/config`)
      .set('Cookie', owner.cookie)
      .send(settings)
      .expect(200);
    const location = await createLocation(householdId);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/restock`)
      .set('Cookie', owner.cookie)
      .send({ quantity: '5', locationId: location.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${base}/${itemId}/use`)
      .set('Cookie', owner.cookie)
      .send({ quantity: '1' })
      .expect(201);
    const endpoint = `/api/households/${householdId}/stock-intelligence`;
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Cookie', other.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .put(`${base}/${itemId}/config`)
      .set('Cookie', other.cookie)
      .send(settings)
      .expect(403);
    const insight = await request(app.getHttpServer())
      .get(endpoint)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(insight.body.assessments).toHaveLength(1);
    expect(insight.body.assessments[0]).toMatchObject({
      itemId,
      physicalStock: '4',
      eligibleStock: '4',
      lowStockRisk: 'BUY',
      reasonExplanations: [
        {
          code: 'QUANTITY_AT_OR_BELOW_BUY_THRESHOLD',
          params: { buyThreshold: '5', unit: 'egg' },
        },
      ],
      prediction: {
        basis: 'THRESHOLD_FALLBACK',
        usedIn14Days: '1',
        explanation: {
          code: 'PREDICTION_INSUFFICIENT_HISTORY',
        },
      },
      suggestion: {
        quantity: '20',
        priority: 'MUST_BUY',
        explanation: {
          code: 'QUANTITY_BUY_TO_TARGET',
          params: { quantity: '20', unit: 'egg', targetStock: '24' },
        },
      },
    });
    expect(insight.body.suggestions).toHaveLength(1);
    await prisma.membership.create({
      data: { userId: other.userId, householdId, role: 'MEMBER' },
    });
    await request(app.getHttpServer())
      .get(endpoint)
      .set('Cookie', other.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .put(`${base}/${itemId}/config`)
      .set('Cookie', other.cookie)
      .send(settings)
      .expect(403);
    const before = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    await request(app.getHttpServer())
      .put(`${base}/${itemId}/config`)
      .set('Cookie', owner.cookie)
      .send({ ...settings, targetStock: '24.0000001' })
      .expect(400);
    const after = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(after).toEqual(before);
  });

  it('exposes session-scoped Inventory filters and Home attention while preserving the plain list', async () => {
    const owner = await register();
    const outsider = await register();
    const householdId = await createHousehold(owner.cookie);
    const base = `/api/households/${householdId}/items`;
    const item = await request(app.getHttpServer())
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'HTTP read item', primaryUnit: 'box' })
      .expect(201);
    const home = `/api/households/${householdId}/home/needs-attention`;
    const plain = await request(app.getHttpServer())
      .get(base)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(Array.isArray(plain.body)).toBe(true);
    const filtered = await request(app.getHttpServer())
      .get(base)
      .query({ q: 'read', status: 'OUT', groupBy: 'location' })
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].assessment).toMatchObject({
      itemId: item.body.id,
      lowStockRisk: 'OUT',
      physicalStock: '0',
      reasonExplanations: [
        { code: 'QUANTITY_NO_ELIGIBLE_STOCK' },
        { code: 'QUANTITY_TARGET_REQUIRED' },
      ],
    });
    expect(filtered.body.groups[0].entries[0]).toMatchObject({
      itemId: item.body.id,
      quantity: '0',
    });
    const attention = await request(app.getHttpServer())
      .get(home)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(attention.body.items[0]).toMatchObject({
      itemId: item.body.id,
      action: 'BUY',
      priority: 'CRITICAL',
      primaryExplanation: { code: 'QUANTITY_NO_ELIGIBLE_STOCK' },
    });
    const opened = await request(app.getHttpServer())
      .get(base)
      .query({ status: 'OPENED' })
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(opened.body.items).toEqual([]);
    await request(app.getHttpServer())
      .get(base)
      .query({ status: 'OUT' })
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(home)
      .set('Cookie', outsider.cookie)
      .expect(403);
    await request(app.getHttpServer()).get(home).expect(401);
  });
});
