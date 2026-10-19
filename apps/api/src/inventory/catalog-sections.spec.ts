import { CatalogService } from './catalog.service.js';

const sections = [
  'FRESH_FOOD',
  'MEAT_SEAFOOD',
  'DAIRY',
  'PANTRY',
  'DRINKS',
  'HOUSEHOLD',
  'PERSONAL_CARE',
] as const;

function setup() {
  const categories = new Map([
    [
      'home-category',
      {
        id: 'home-category',
        householdId: 'home',
        name: 'Kitchen',
        shoppingSection: null as string | null,
        defaultTrackingMode: null as string | null,
        defaultPrimaryUnit: null as string | null,
      },
    ],
    [
      'other-category',
      {
        id: 'other-category',
        householdId: 'other',
        name: 'Kitchen',
        shoppingSection: null as string | null,
      },
    ],
  ]);
  const prisma = {
    membership: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            userId_householdId: { userId: string; householdId: string };
          };
        }) => {
          const { userId, householdId } = where.userId_householdId;
          if (userId === 'admin' && householdId === 'home')
            return { role: 'ADMIN' };
          if (userId === 'other-admin' && householdId === 'other')
            return { role: 'ADMIN' };
          if (userId === 'member' && householdId === 'home')
            return { role: 'MEMBER' };
          return null;
        },
      ),
    },
    category: {
      findMany: vi.fn(async ({ where }: { where: { householdId: string } }) =>
        [...categories.values()]
          .filter((row) => row.householdId === where.householdId)
          .map(
            ({
              id,
              name,
              shoppingSection,
              defaultTrackingMode,
              defaultPrimaryUnit,
            }) => ({
              id,
              name,
              shoppingSection,
              defaultTrackingMode,
              defaultPrimaryUnit,
            }),
          ),
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; householdId: string };
          data: Record<string, unknown>;
        }) => {
          const row = categories.get(where.id);
          if (!row || row.householdId !== where.householdId)
            throw new Error('CATEGORY_NOT_FOUND');
          if ('shoppingSection' in data)
            row.shoppingSection = data.shoppingSection as string | null;
          return {
            id: row.id,
            name: row.name,
            shoppingSection: row.shoppingSection,
            defaultTrackingMode: row.defaultTrackingMode,
            defaultPrimaryUnit: row.defaultPrimaryUnit,
          };
        },
      ),
    },
  };
  return { service: new CatalogService(prisma as never), prisma, categories };
}

describe('category shopping sections', () => {
  it('accepts every approved code, exposes it on category reads, and clears it', async () => {
    const { service } = setup();
    for (const shoppingSection of sections) {
      expect(
        await service.updateCategorySection('admin', 'home', 'home-category', {
          shoppingSection,
        }),
      ).toEqual({
        id: 'home-category',
        name: 'Kitchen',
        shoppingSection,
        defaultTrackingMode: null,
        defaultPrimaryUnit: null,
      });
      expect(await service.list('member', 'home', 'categories')).toEqual([
        {
          id: 'home-category',
          name: 'Kitchen',
          shoppingSection,
          defaultTrackingMode: null,
          defaultPrimaryUnit: null,
        },
      ]);
    }
    expect(
      await service.updateCategorySection('admin', 'home', 'home-category', {
        shoppingSection: null,
      }),
    ).toMatchObject({ shoppingSection: null });
  });

  it('rejects unknown codes and extra fields without writing', async () => {
    const { service, prisma } = setup();
    for (const input of [
      {},
      { shoppingSection: 'OTHER' },
      { shoppingSection: 'fresh_food' },
      { shoppingSection: 1 },
      { shoppingSection: 'DAIRY', name: 'Renamed' },
    ])
      await expect(
        service.updateCategorySection('admin', 'home', 'home-category', input),
      ).rejects.toMatchObject({ status: 400 });
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('requires that household Admin and cannot update another household category', async () => {
    const { service, prisma, categories } = setup();
    await expect(
      service.updateCategorySection('member', 'home', 'home-category', {
        shoppingSection: 'PANTRY',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateCategorySection('other-admin', 'home', 'home-category', {
        shoppingSection: 'PANTRY',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateCategorySection('admin', 'other', 'other-category', {
        shoppingSection: 'PANTRY',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.category.update).not.toHaveBeenCalled();
    expect(categories.get('other-category')?.shoppingSection).toBeNull();
  });
});
