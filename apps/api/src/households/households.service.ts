import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { tokenHash } from '../auth/auth.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const invitationAgeMs = 7 * 24 * 60 * 60 * 1000;

function invitationHash(secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new NotFoundException('INVITATION_NOT_FOUND');
  return tokenHash(secret);
}

function invitationStatus(
  invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  },
  at: Date,
) {
  if (invitation.acceptedAt) return 'USED' as const;
  if (invitation.revokedAt) return 'REVOKED' as const;
  if (invitation.expiresAt <= at) return 'EXPIRED' as const;
  return 'ACTIVE' as const;
}

function shoppingSettingsUpdate(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('INVALID_SHOPPING_SETTINGS');
  const body = input as Record<string, unknown>;
  if (
    !Object.keys(body).length ||
    Object.keys(body).some(
      (key) => !['defaultShoppingCycleDays', 'defaultStore'].includes(key),
    )
  )
    throw new BadRequestException('INVALID_SHOPPING_SETTINGS');
  const data: {
    defaultShoppingCycleDays?: number;
    defaultStore?: string | null;
  } = {};
  if ('defaultShoppingCycleDays' in body) {
    if (
      typeof body.defaultShoppingCycleDays !== 'number' ||
      !Number.isInteger(body.defaultShoppingCycleDays) ||
      body.defaultShoppingCycleDays < 1 ||
      body.defaultShoppingCycleDays > 30
    )
      throw new BadRequestException('INVALID_SHOPPING_CYCLE');
    data.defaultShoppingCycleDays = body.defaultShoppingCycleDays;
  }
  if ('defaultStore' in body) {
    if (body.defaultStore === null) data.defaultStore = null;
    else if (
      typeof body.defaultStore === 'string' &&
      body.defaultStore.trim().length > 0 &&
      body.defaultStore.trim().length <= 120
    )
      data.defaultStore = body.defaultStore.trim();
    else throw new BadRequestException('INVALID_DEFAULT_STORE');
  }
  return data;
}

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  private async lockHousehold(
    tx: Prisma.TransactionClient,
    householdId: string,
  ) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Household" WHERE "id" = ${householdId} FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
  }

  private async requireAdmin(
    db: Pick<Prisma.TransactionClient, 'membership'>,
    actorId: string,
    householdId: string,
  ) {
    const membership = await db.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { role: true },
    });
    if (membership?.role !== 'ADMIN')
      throw new ForbiddenException('HOUSEHOLD_ADMIN_REQUIRED');
  }

  private async requireMember(
    db: Pick<Prisma.TransactionClient, 'membership'>,
    actorId: string,
    householdId: string,
  ) {
    const membership = await db.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { userId: true },
    });
    if (!membership)
      throw new ForbiddenException('HOUSEHOLD_MEMBERSHIP_REQUIRED');
  }

  async shoppingSettings(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireMember(tx, actorId, householdId);
      return tx.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { defaultShoppingCycleDays: true, defaultStore: true },
      });
    });
  }

  async updateShoppingSettings(
    actorId: string,
    householdId: string,
    input: unknown,
  ) {
    const data = shoppingSettingsUpdate(input);
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      return tx.household.update({
        where: { id: householdId },
        data,
        select: { defaultShoppingCycleDays: true, defaultStore: true },
      });
    });
  }

  async create(actorId: string, name: unknown) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Household name is required.');
    }
    return this.prisma.household.create({
      data: {
        name: name.trim(),
        memberships: { create: { userId: actorId, role: 'ADMIN' } },
      },
      select: { id: true, name: true },
    });
  }

  async list(actorId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: actorId },
      select: { role: true, household: { select: { id: true, name: true } } },
      orderBy: { household: { name: 'asc' } },
    });
    return memberships.map(({ role, household }) => ({ ...household, role }));
  }

  async createInvitation(actorId: string, householdId: string) {
    const secret = randomBytes(32).toString('base64url');
    const now = new Date();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      return tx.householdInvitation.create({
        data: {
          householdId,
          createdByUserId: actorId,
          secretHash: tokenHash(secret),
          createdAt: now,
          expiresAt: new Date(now.getTime() + invitationAgeMs),
        },
        select: { id: true, expiresAt: true },
      });
    });
    return { ...invitation, invitePath: `/invite/${secret}` };
  }

  async invitations(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      const rows = await tx.householdInvitation.findMany({
        where: { householdId },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          revokedAt: true,
          acceptedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const at = new Date();
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        status: invitationStatus(row, at),
      }));
    });
  }

  async previewInvitation(secret: string) {
    const invitation = await this.prisma.householdInvitation.findUnique({
      where: { secretHash: invitationHash(secret) },
      select: {
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        household: { select: { id: true, name: true } },
      },
    });
    if (!invitation) throw new NotFoundException('INVITATION_NOT_FOUND');
    return {
      household: invitation.household,
      status: invitationStatus(invitation, new Date()),
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(actorId: string, secret: string) {
    const secretHash = invitationHash(secret);
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.householdInvitation.findUnique({
        where: { secretHash },
        select: { householdId: true },
      });
      if (!initial) throw new NotFoundException('INVITATION_NOT_FOUND');
      await this.lockHousehold(tx, initial.householdId);
      await tx.$queryRaw`
        SELECT "id" FROM "HouseholdInvitation" WHERE "secretHash" = ${secretHash} FOR UPDATE
      `;
      const invitation = await tx.householdInvitation.findUniqueOrThrow({
        where: { secretHash },
        select: {
          id: true,
          householdId: true,
          expiresAt: true,
          revokedAt: true,
          acceptedAt: true,
          household: { select: { id: true, name: true } },
        },
      });
      const status = invitationStatus(invitation, new Date());
      if (status !== 'ACTIVE') throw new GoneException(`INVITATION_${status}`);
      const member = await tx.membership.findUnique({
        where: {
          userId_householdId: {
            userId: actorId,
            householdId: invitation.householdId,
          },
        },
      });
      if (member) throw new ConflictException('ALREADY_MEMBER');
      await tx.membership.create({
        data: {
          userId: actorId,
          householdId: invitation.householdId,
          role: 'MEMBER',
        },
      });
      const acceptedAt = new Date();
      const consumed = await tx.householdInvitation.updateMany({
        where: {
          id: invitation.id,
          expiresAt: { gt: acceptedAt },
          acceptedAt: null,
          revokedAt: null,
        },
        data: { acceptedAt, acceptedByUserId: actorId },
      });
      if (consumed.count !== 1) throw new GoneException('INVITATION_EXPIRED');
      return { household: invitation.household, role: 'MEMBER' as const };
    });
  }

  async revokeInvitation(
    actorId: string,
    householdId: string,
    invitationId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      await tx.$queryRaw`
        SELECT "id" FROM "HouseholdInvitation" WHERE "id" = ${invitationId} AND "householdId" = ${householdId} FOR UPDATE
      `;
      const invitation = await tx.householdInvitation.findFirst({
        where: { id: invitationId, householdId },
        select: { acceptedAt: true, revokedAt: true },
      });
      if (!invitation) throw new NotFoundException('INVITATION_NOT_FOUND');
      if (invitation.acceptedAt) throw new ConflictException('INVITATION_USED');
      if (invitation.revokedAt) return { revoked: false };
      await tx.householdInvitation.update({
        where: { id: invitationId },
        data: { revokedAt: new Date() },
      });
      return { revoked: true };
    });
  }

  async members(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      const rows = await tx.membership.findMany({
        where: { householdId },
        select: {
          role: true,
          user: { select: { id: true, email: true } },
        },
        orderBy: { user: { email: 'asc' } },
      });
      return rows.map((row) => ({ ...row.user, role: row.role }));
    });
  }

  async removeMember(actorId: string, householdId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      const member = await tx.membership.findUnique({
        where: { userId_householdId: { userId, householdId } },
        select: { role: true },
      });
      if (!member) throw new NotFoundException('MEMBER_NOT_FOUND');
      if (member.role === 'ADMIN') {
        const adminCount = await tx.membership.count({
          where: { householdId, role: 'ADMIN' },
        });
        if (adminCount <= 1) throw new ConflictException('LAST_ADMIN');
      }
      await tx.membership.delete({
        where: { userId_householdId: { userId, householdId } },
      });
      return { removed: true };
    });
  }
}
