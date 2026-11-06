import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

type Client = Prisma.TransactionClient;

export async function checkActiveHousehold(
  client: Pick<Client, 'membership' | 'household'>,
  actorId: string,
  householdId: string,
  role: 'MEMBER' | 'ADMIN' = 'MEMBER',
) {
  const membership = await client.membership.findUnique({
    where: { userId_householdId: { userId: actorId, householdId } },
    select: { role: true },
  });
  if (!membership || (role === 'ADMIN' && membership.role !== 'ADMIN'))
    throw new ForbiddenException(
      role === 'ADMIN'
        ? 'HOUSEHOLD_ADMIN_REQUIRED'
        : 'HOUSEHOLD_MEMBERSHIP_REQUIRED',
    );
  const household = await client.household.findUnique({
    where: { id: householdId },
    select: { deletionRequestId: true },
  });
  if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
  if (household.deletionRequestId)
    throw new ConflictException('HOUSEHOLD_PENDING_DELETION');
  return membership;
}

// This is the first row lock in every ordinary household transaction.
// Checking membership first avoids revealing a pending household to outsiders.
export async function requireActiveHousehold(
  tx: Client,
  actorId: string,
  householdId: string,
  role: 'MEMBER' | 'ADMIN' = 'MEMBER',
) {
  const membership = await tx.membership.findUnique({
    where: { userId_householdId: { userId: actorId, householdId } },
    select: { role: true },
  });
  if (!membership || (role === 'ADMIN' && membership.role !== 'ADMIN'))
    throw new ForbiddenException(
      role === 'ADMIN'
        ? 'HOUSEHOLD_ADMIN_REQUIRED'
        : 'HOUSEHOLD_MEMBERSHIP_REQUIRED',
    );
  const rows = await tx.$queryRaw<
    Array<{ id: string; deletionRequestId: string | null }>
  >`
    SELECT "id", "deletionRequestId" FROM "Household"
    WHERE "id" = ${householdId} FOR SHARE
  `;
  if (!rows.length) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
  // Membership removal also locks Household. Recheck after locking so a
  // removal that committed while we waited cannot leave this request active.
  const current = await tx.membership.findUnique({
    where: { userId_householdId: { userId: actorId, householdId } },
    select: { role: true },
  });
  if (!current || (role === 'ADMIN' && current.role !== 'ADMIN'))
    throw new ForbiddenException(
      role === 'ADMIN'
        ? 'HOUSEHOLD_ADMIN_REQUIRED'
        : 'HOUSEHOLD_MEMBERSHIP_REQUIRED',
    );
  if (rows[0].deletionRequestId)
    throw new ConflictException('HOUSEHOLD_PENDING_DELETION');
  return current;
}

// Invitation tokens are not authorization to see a pending household's name.
export async function requireActiveInvitationHousehold(
  tx: Client,
  householdId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{ id: string; deletionRequestId: string | null }>
  >`
    SELECT "id", "deletionRequestId" FROM "Household"
    WHERE "id" = ${householdId} FOR SHARE
  `;
  if (!rows.length || rows[0].deletionRequestId)
    throw new GoneException('INVITATION_HOUSEHOLD_UNAVAILABLE');
}
