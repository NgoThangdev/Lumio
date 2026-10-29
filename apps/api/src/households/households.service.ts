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
import {
  requireActiveHousehold,
  requireActiveInvitationHousehold,
} from './active-household.js';
import { HouseholdPurgeService } from './household-purge.service.js';

const invitationAgeMs = 7 * 24 * 60 * 60 * 1000;
const householdDeletionDelayMs = 7 * 24 * 60 * 60 * 1000;

const impactKeys = [
  'members',
  'invitations',
  'categories',
  'locations',
  'tags',
  'activeItems',
  'archivedItems',
  'stockBatches',
  'inventoryActions',
  'stateActions',
  'undos',
  'itemChanges',
  'shoppingTrips',
  'shoppingEntries',
  'tripStockChecks',
  'locationStockChecks',
  'notificationIntents',
  'notificationDeliveries',
] as const;

type HouseholdImpact = Record<(typeof impactKeys)[number], number>;

function parseDeletionConfirmation(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('INVALID_HOUSEHOLD_DELETION_CONFIRMATION');
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).length !== 2 ||
    typeof body.confirmName !== 'string' ||
    !body.confirmName.length ||
    !body.confirmedImpact ||
    typeof body.confirmedImpact !== 'object' ||
    Array.isArray(body.confirmedImpact)
  )
    throw new BadRequestException('INVALID_HOUSEHOLD_DELETION_CONFIRMATION');
  const supplied = body.confirmedImpact as Record<string, unknown>;
  const keys = Object.keys(supplied);
  if (
    keys.length !== impactKeys.length ||
    impactKeys.some(
      (key) =>
        !(key in supplied) ||
        typeof supplied[key] !== 'number' ||
        !Number.isSafeInteger(supplied[key]) ||
        (supplied[key] as number) < 0,
    )
  )
    throw new BadRequestException('INVALID_HOUSEHOLD_DELETION_IMPACT');
  return {
    confirmName: body.confirmName,
    confirmedImpact: supplied as HouseholdImpact,
  };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly purge: HouseholdPurgeService,
  ) {}

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

  private async assertActive(
    tx: Prisma.TransactionClient,
    householdId: string,
  ) {
    const household = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { deletionRequestId: true },
    });
    if (household.deletionRequestId)
      throw new ConflictException('HOUSEHOLD_PENDING_DELETION');
  }

  private async deletionImpact(
    tx: Prisma.TransactionClient,
    householdId: string,
  ) {
    const household = await tx.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { id: true, name: true },
    });
    const [
      members,
      invitations,
      categories,
      locations,
      tags,
      activeItems,
      archivedItems,
      stockBatches,
      inventoryActions,
      stateActions,
      undos,
      itemChanges,
      shoppingTrips,
      shoppingEntries,
      tripStockChecks,
      locationStockChecks,
      notificationIntents,
      notificationDeliveries,
    ] = await Promise.all([
      tx.membership.count({ where: { householdId } }),
      tx.householdInvitation.count({ where: { householdId } }),
      tx.category.count({ where: { householdId } }),
      tx.location.count({ where: { householdId } }),
      tx.tag.count({ where: { householdId } }),
      tx.inventoryItem.count({ where: { householdId, archivedAt: null } }),
      tx.inventoryItem.count({
        where: { householdId, archivedAt: { not: null } },
      }),
      tx.stockBatch.count({ where: { item: { householdId } } }),
      tx.inventoryAction.count({ where: { householdId } }),
      tx.inventoryStateAction.count({ where: { householdId } }),
      tx.inventoryUndo.count({ where: { householdId } }),
      tx.inventoryItemChange.count({ where: { householdId } }),
      tx.shoppingTrip.count({ where: { householdId } }),
      tx.shoppingEntry.count({ where: { trip: { householdId } } }),
      tx.tripStockCheck.count({ where: { trip: { householdId } } }),
      tx.locationStockCheck.count({ where: { householdId } }),
      tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM "NotificationIntent" i
        WHERE i."householdId" = ${householdId}
          OR (
            jsonb_typeof(i."content"->'households') = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(i."content"->'households') AS g(value)
              WHERE g.value->>'householdId' = ${householdId}
            )
          )
      `,
      tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM "NotificationDelivery" d
        JOIN "NotificationIntent" i ON i."id" = d."intentId"
        WHERE i."householdId" = ${householdId}
          OR (
            jsonb_typeof(i."content"->'households') = 'array'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(i."content"->'households') AS g(value)
              WHERE g.value->>'householdId' = ${householdId}
            )
          )
      `,
    ]);
    const counts: HouseholdImpact = {
      members,
      invitations,
      categories,
      locations,
      tags,
      activeItems,
      archivedItems,
      stockBatches,
      inventoryActions,
      stateActions,
      undos,
      itemChanges,
      shoppingTrips,
      shoppingEntries,
      tripStockChecks,
      locationStockChecks,
      notificationIntents: notificationIntents[0]?.count ?? 0,
      notificationDeliveries: notificationDeliveries[0]?.count ?? 0,
    };
    return { household, counts };
  }

  async deletionImpactForAdmin(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await requireActiveHousehold(tx, actorId, householdId, 'ADMIN');
      return this.deletionImpact(tx, householdId);
    });
  }

  async scheduleDeletion(actorId: string, householdId: string, input: unknown) {
    const confirmation = parseDeletionConfirmation(input);
    return this.prisma.$transaction(async (tx) => {
      // Check membership before locking or disclosing whether the household is pending.
      await this.requireAdmin(tx, actorId, householdId);
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      const state = await tx.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { deletionRequestId: true },
      });
      if (state.deletionRequestId)
        throw new ConflictException({
          code: 'HOUSEHOLD_DELETION_ALREADY_PENDING',
        });

      const impact = await this.deletionImpact(tx, householdId);
      if (confirmation.confirmName !== impact.household.name)
        throw new ConflictException({
          code: 'HOUSEHOLD_NAME_CONFIRMATION_MISMATCH',
        });
      if (
        impactKeys.some(
          (key) => confirmation.confirmedImpact[key] !== impact.counts[key],
        )
      )
        throw new ConflictException({
          code: 'HOUSEHOLD_IMPACT_CHANGED',
          impact,
        });

      const requestedAt = new Date();
      const dueAt = new Date(requestedAt.getTime() + householdDeletionDelayMs);
      const requestId = randomBytes(32).toString('base64url');
      await tx.household.update({
        where: { id: householdId },
        data: {
          deletionRequestId: requestId,
          deletionRequestedAt: requestedAt,
          deletionDueAt: dueAt,
        },
      });
      return { requestId, requestedAt, dueAt, impact };
    });
  }

  async deleteImmediately(
    actorId: string,
    householdId: string,
    input: unknown,
  ) {
    const confirmation = parseDeletionConfirmation(input);
    const deletedAt = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Membership must be established before the request can learn household state.
        await this.requireAdmin(tx, actorId, householdId);
        await this.lockHousehold(tx, householdId);
        await this.requireAdmin(tx, actorId, householdId);
        const state = await tx.household.findUniqueOrThrow({
          where: { id: householdId },
          select: { deletionRequestId: true },
        });
        if (state.deletionRequestId)
          throw new ConflictException({
            code: 'HOUSEHOLD_PENDING_DELETION_CANCEL_FIRST',
          });

        const impact = await this.deletionImpact(tx, householdId);
        if (confirmation.confirmName !== impact.household.name)
          throw new ConflictException({
            code: 'HOUSEHOLD_NAME_CONFIRMATION_MISMATCH',
          });
        if (
          impactKeys.some(
            (key) => confirmation.confirmedImpact[key] !== impact.counts[key],
          )
        )
          throw new ConflictException({
            code: 'HOUSEHOLD_IMPACT_CHANGED',
            impact,
          });

        await this.purge.purge(tx, householdId);
        return { deleted: true, householdId, deletedAt, impact };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new ConflictException({
          code: 'HOUSEHOLD_PURGE_BLOCKED_BY_REFERENCE',
        });
      throw error;
    }
  }

  async pendingDeletions(actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          requestId: string;
          requestedAt: Date;
          dueAt: Date;
        }>
      >`
        SELECT h."id"
        FROM "Household" h
        JOIN "Membership" m ON m."householdId" = h."id"
        WHERE m."userId" = ${actorId} AND m."role" = 'ADMIN'
          AND h."deletionRequestId" IS NOT NULL
        ORDER BY h."id" ASC
        FOR SHARE OF h
      `;
      if (!rows.length) return [];
      const currentAdminRows = await tx.membership.findMany({
        where: {
          userId: actorId,
          role: 'ADMIN',
          householdId: { in: rows.map((row) => row.id) },
          household: { deletionRequestId: { not: null } },
        },
        select: {
          household: {
            select: {
              id: true,
              name: true,
              deletionRequestId: true,
              deletionRequestedAt: true,
              deletionDueAt: true,
            },
          },
        },
      });
      return currentAdminRows
        .map(({ household }) => ({
          id: household.id,
          name: household.name,
          requestId: household.deletionRequestId!,
          requestedAt: household.deletionRequestedAt!,
          dueAt: household.deletionDueAt!,
        }))
        .sort(
          (left, right) =>
            left.dueAt.getTime() - right.dueAt.getTime() ||
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        );
    });
  }

  async cancelDeletion(
    actorId: string,
    householdId: string,
    requestId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireAdmin(tx, actorId, householdId);
      await this.lockHousehold(tx, householdId);
      await this.requireAdmin(tx, actorId, householdId);
      const state = await tx.household.findUniqueOrThrow({
        where: { id: householdId },
        select: { deletionRequestId: true },
      });
      if (state.deletionRequestId !== requestId)
        throw new ConflictException({
          code: 'HOUSEHOLD_DELETION_REQUEST_STALE',
        });
      await tx.household.update({
        where: { id: householdId },
        data: {
          deletionRequestId: null,
          deletionRequestedAt: null,
          deletionDueAt: null,
        },
      });
      return { cancelled: true, householdId, requestId };
    });
  }

  async shoppingSettings(actorId: string, householdId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHousehold(tx, householdId);
      await this.requireMember(tx, actorId, householdId);
      await this.assertActive(tx, householdId);
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
      await this.assertActive(tx, householdId);
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
      where: { userId: actorId, household: { deletionRequestId: null } },
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
      await this.assertActive(tx, householdId);
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
      await this.assertActive(tx, householdId);
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
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.householdInvitation.findUnique({
        where: { secretHash: invitationHash(secret) },
        select: {
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          household: { select: { id: true, name: true } },
        },
      });
      if (!invitation) throw new NotFoundException('INVITATION_NOT_FOUND');
      await requireActiveInvitationHousehold(tx, invitation.household.id);
      return {
        household: invitation.household,
        status: invitationStatus(invitation, new Date()),
        expiresAt: invitation.expiresAt,
      };
    });
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
      await requireActiveInvitationHousehold(tx, initial.householdId);
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
      await this.assertActive(tx, householdId);
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
      await this.assertActive(tx, householdId);
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
      await this.assertActive(tx, householdId);
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
