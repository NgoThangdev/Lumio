import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type CatalogKind = 'categories' | 'locations' | 'tags';

function catalogName(value: unknown) {
  if (typeof value !== 'string')
    throw new BadRequestException('Name is required.');
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80)
    throw new BadRequestException('Name must be 1 to 80 characters.');
  return { name, nameKey: name.toLocaleLowerCase('en-US') };
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(
    actorId: string,
    householdId: string,
    admin: boolean,
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_householdId: { userId: actorId, householdId } },
      select: { role: true },
    });
    if (!membership || (admin && membership.role !== 'ADMIN')) {
      throw new ForbiddenException(
        admin
          ? 'Household Admin membership is required to manage catalog options.'
          : 'Household membership is required to view catalog options.',
      );
    }
  }

  async list(actorId: string, householdId: string, kind: CatalogKind) {
    await this.requireMembership(actorId, householdId, false);
    const query = {
      where: { householdId },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
    };
    if (kind === 'categories') return this.prisma.category.findMany(query);
    if (kind === 'locations') return this.prisma.location.findMany(query);
    return this.prisma.tag.findMany(query);
  }

  async create(
    actorId: string,
    householdId: string,
    kind: CatalogKind,
    inputName: unknown,
  ) {
    const parsed = catalogName(inputName);
    await this.requireMembership(actorId, householdId, true);
    const data = { householdId, ...parsed };
    try {
      if (kind === 'categories')
        return await this.prisma.category.create({
          data,
          select: { id: true, name: true },
        });
      if (kind === 'locations')
        return await this.prisma.location.create({
          data,
          select: { id: true, name: true },
        });
      return await this.prisma.tag.create({
        data,
        select: { id: true, name: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A catalog option with this name already exists in the household.',
        );
      }
      throw error;
    }
  }
}
