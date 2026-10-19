import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { tokenHash } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Household invitations and members (database)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: string[];
  let households: string[];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => {
    users = [];
    households = [];
  });
  afterEach(async () => {
    await prisma.householdInvitation.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.membership.deleteMany({
      where: { householdId: { in: households } },
    });
    await prisma.household.deleteMany({ where: { id: { in: households } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  afterAll(async () => app.close());

  async function account() {
    const email = `${randomUUID()}@example.invalid`;
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'fixture-password-123' })
      .expect(201);
    users.push(response.body.id as string);
    return {
      id: response.body.id as string,
      email,
      cookie: (response.headers['set-cookie'] as string[])[0].split(';')[0],
    };
  }

  async function household(cookie: string) {
    const response = await request(app.getHttpServer())
      .post('/api/households')
      .set('Cookie', cookie)
      .send({ name: 'Shared kitchen' })
      .expect(201);
    households.push(response.body.id as string);
    return response.body.id as string;
  }

  async function invitation(cookie: string, householdId: string) {
    const response = await request(app.getHttpServer())
      .post(`/api/households/${householdId}/invitations`)
      .set('Cookie', cookie)
      .expect(201);
    const secret = (response.body.invitePath as string).split('/').at(-1)!;
    return {
      id: response.body.id as string,
      secret,
      expiresAt: response.body.expiresAt as string,
    };
  }

  it('lists only this household invitations for its Admin with derived status and no secret', async () => {
    const admin = await account();
    const otherAdmin = await account();
    const guest = await account();
    const householdId = await household(admin.cookie);
    const otherHouseholdId = await household(otherAdmin.cookie);
    const active = await invitation(admin.cookie, householdId);
    const expired = await invitation(admin.cookie, householdId);
    const revoked = await invitation(admin.cookie, householdId);
    const used = await invitation(admin.cookie, householdId);
    const other = await invitation(otherAdmin.cookie, otherHouseholdId);
    await prisma.householdInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .delete(`/api/households/${householdId}/invitations/${revoked.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/invitations/${used.secret}/accept`)
      .set('Cookie', guest.cookie)
      .expect(201);
    const url = `/api/households/${householdId}/invitations`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer())
      .get(url)
      .set('Cookie', guest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(url)
      .set('Cookie', otherAdmin.cookie)
      .expect(403);
    const response = await request(app.getHttpServer())
      .get(url)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(response.body).toHaveLength(4);
    expect(
      Object.fromEntries(
        response.body.map((row: { id: string; status: string }) => [
          row.id,
          row.status,
        ]),
      ),
    ).toEqual({
      [active.id]: 'ACTIVE',
      [expired.id]: 'EXPIRED',
      [revoked.id]: 'REVOKED',
      [used.id]: 'USED',
    });
    for (const row of response.body as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual([
        'createdAt',
        'expiresAt',
        'id',
        'status',
      ]);
      expect(typeof row.createdAt).toBe('string');
      expect(typeof row.expiresAt).toBe('string');
    }
    expect(response.text).not.toContain(active.secret);
    expect(response.text).not.toContain(tokenHash(active.secret));
    expect(response.text).not.toContain(other.id);
    const otherResponse = await request(app.getHttpServer())
      .get(`/api/households/${otherHouseholdId}/invitations`)
      .set('Cookie', otherAdmin.cookie)
      .expect(200);
    expect(otherResponse.body.map((row: { id: string }) => row.id)).toEqual([
      other.id,
    ]);
  });

  it('previews without consuming, accepts once as Member, and protects the last Admin', async () => {
    const admin = await account();
    const guest = await account();
    const householdId = await household(admin.cookie);
    const invite = await invitation(admin.cookie, householdId);
    const stored = await prisma.householdInvitation.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(stored.secretHash).toBe(tokenHash(invite.secret));
    expect(JSON.stringify(stored)).not.toContain(invite.secret);
    expect(
      new Date(invite.expiresAt).getTime() - stored.createdAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    const previewUrl = `/api/invitations/${invite.secret}`;
    await request(app.getHttpServer())
      .get(previewUrl)
      .expect(200, {
        household: { id: householdId, name: 'Shared kitchen' },
        status: 'ACTIVE',
        expiresAt: invite.expiresAt,
      });
    await request(app.getHttpServer()).get(previewUrl).expect(200);
    expect(
      (
        await prisma.householdInvitation.findUniqueOrThrow({
          where: { id: invite.id },
        })
      ).acceptedAt,
    ).toBeNull();
    await request(app.getHttpServer()).post(`${previewUrl}/accept`).expect(401);
    const accepted = await request(app.getHttpServer())
      .post(`${previewUrl}/accept`)
      .set('Cookie', guest.cookie)
      .expect(201);
    expect(accepted.body).toEqual({
      household: { id: householdId, name: 'Shared kitchen' },
      role: 'MEMBER',
    });
    expect(
      (
        await prisma.membership.findUniqueOrThrow({
          where: { userId_householdId: { userId: guest.id, householdId } },
        })
      ).role,
    ).toBe('MEMBER');
    expect(
      (await request(app.getHttpServer()).get(previewUrl).expect(200)).body
        .status,
    ).toBe('USED');
    expect(
      (
        await request(app.getHttpServer())
          .post(`${previewUrl}/accept`)
          .set('Cookie', guest.cookie)
          .expect(410)
      ).body.message,
    ).toBe('INVITATION_USED');
    const membersUrl = `/api/households/${householdId}/members`;
    await request(app.getHttpServer())
      .post(`/api/households/${householdId}/invitations`)
      .set('Cookie', guest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/households/${householdId}/invitations/${invite.id}`)
      .set('Cookie', guest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(membersUrl)
      .set('Cookie', guest.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${membersUrl}/${admin.id}`)
      .set('Cookie', guest.cookie)
      .expect(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(membersUrl)
          .set('Cookie', admin.cookie)
          .expect(200)
      ).body,
    ).toEqual(
      [
        { id: admin.id, email: admin.email, role: 'ADMIN' },
        { id: guest.id, email: guest.email, role: 'MEMBER' },
      ].sort((a, b) => a.email.localeCompare(b.email)),
    );
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${membersUrl}/${admin.id}`)
          .set('Cookie', admin.cookie)
          .expect(409)
      ).body.message,
    ).toBe('LAST_ADMIN');
    await request(app.getHttpServer())
      .delete(`${membersUrl}/${guest.id}`)
      .set('Cookie', admin.cookie)
      .expect(200, { removed: true });
    expect(await prisma.membership.count({ where: { householdId } })).toBe(1);
  });

  it('enforces household Admin boundaries, expiry, revocation, and duplicate membership', async () => {
    const admin = await account();
    const otherAdmin = await account();
    const guest = await account();
    const householdId = await household(admin.cookie);
    const otherHouseholdId = await household(otherAdmin.cookie);
    const base = `/api/households/${householdId}`;
    await request(app.getHttpServer())
      .post(`${base}/invitations`)
      .set('Cookie', otherAdmin.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/members`)
      .set('Cookie', otherAdmin.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/members/${admin.id}`)
      .set('Cookie', otherAdmin.cookie)
      .expect(403);
    const expired = await invitation(admin.cookie, householdId);
    await prisma.householdInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/invitations/${expired.secret}`)
          .expect(200)
      ).body.status,
    ).toBe('EXPIRED');
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/invitations/${expired.secret}/accept`)
          .set('Cookie', guest.cookie)
          .expect(410)
      ).body.message,
    ).toBe('INVITATION_EXPIRED');
    const revoked = await invitation(admin.cookie, householdId);
    await request(app.getHttpServer())
      .delete(`/api/households/${otherHouseholdId}/invitations/${revoked.id}`)
      .set('Cookie', otherAdmin.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${base}/invitations/${revoked.id}`)
      .set('Cookie', otherAdmin.cookie)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/invitations/${revoked.id}`)
      .set('Cookie', admin.cookie)
      .expect(200, { revoked: true });
    await request(app.getHttpServer())
      .delete(`${base}/invitations/${revoked.id}`)
      .set('Cookie', admin.cookie)
      .expect(200, { revoked: false });
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/invitations/${revoked.secret}`)
          .expect(200)
      ).body.status,
    ).toBe('REVOKED');
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/invitations/${revoked.secret}/accept`)
          .set('Cookie', guest.cookie)
          .expect(410)
      ).body.message,
    ).toBe('INVITATION_REVOKED');
    const first = await invitation(admin.cookie, householdId);
    await request(app.getHttpServer())
      .post(`/api/invitations/${first.secret}/accept`)
      .set('Cookie', guest.cookie)
      .expect(201);
    const duplicate = await invitation(admin.cookie, householdId);
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/invitations/${duplicate.secret}/accept`)
          .set('Cookie', guest.cookie)
          .expect(409)
      ).body.message,
    ).toBe('ALREADY_MEMBER');
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/invitations/${duplicate.secret}`)
          .expect(200)
      ).body.status,
    ).toBe('ACTIVE');
  });

  it('serializes concurrent acceptance of a one-time link', async () => {
    const admin = await account();
    const first = await account();
    const second = await account();
    const householdId = await household(admin.cookie);
    const invite = await invitation(admin.cookie, householdId);
    const url = `/api/invitations/${invite.secret}/accept`;
    const responses = await Promise.all([
      request(app.getHttpServer()).post(url).set('Cookie', first.cookie),
      request(app.getHttpServer()).post(url).set('Cookie', second.cookie),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 410]);
    expect(
      await prisma.membership.count({ where: { householdId, role: 'MEMBER' } }),
    ).toBe(1);
    expect(
      (
        await prisma.householdInvitation.findUniqueOrThrow({
          where: { id: invite.id },
        })
      ).acceptedByUserId,
    ).toBe(responses[0].status === 201 ? first.id : second.id);
  });
});
