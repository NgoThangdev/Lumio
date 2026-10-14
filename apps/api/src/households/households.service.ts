import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
