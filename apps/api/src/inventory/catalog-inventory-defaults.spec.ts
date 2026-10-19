import { CatalogService } from './catalog.service.js';

function setup() {
  const categories = new Map([
    [
      'home-category',
      {
        id: 'home-category',
        householdId: 'home',
        name: 'Pantry',
        shoppingSection: 'PANTRY',
        defaultTrackingMode: null as string | null,
        defaultPrimaryUnit: null as string | null,
      },
    ],
    [
      'other-category',
      {
        id: 'other-category',
        householdId: 'other',
        name: 'Pantry',
        shoppingSection: null,
        defaultTrackingMode: null as string | null,
        defaultPrimaryUnit: null as string | null,
      },
    ],
  ]);
  const membership = vi.fn(
    async ({
      where,
    }: {
      where: { userId_householdId: { userId: string; householdId: string } };
    }) => {
      const { userId, householdId } = where.userId_householdId;
      if (
        (userId === 'admin' && householdId === 'home') ||
        (userId === 'other-admin' && householdId === 'other')
      )
        return { role: 'ADMIN' };
      if (userId === 'member' && householdId === 'home')
        return { role: 'MEMBER' };
      return null;
    },
  );
  const categoryUpdate = vi.fn(
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
      Object.assign(row, data);
      return { ...row };
    },
  );
  const categoryFindMany = vi.fn(
    async ({ where }: { where: { householdId: string } }) =>
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
  );
  const prisma = {
    membership: { findUnique: membership },
    category: { update: categoryUpdate, findMany: categoryFindMany },
  };
  return { service: new CatalogService(prisma as never), prisma, categories };
}

describe('category inventory defaults', () => {
  it('sets independent hints and clearing one leaves the other intact', async () => {
    const { service } = setup();
    expect(
      await service.updateCategoryInventoryDefaults(
        'admin',
        'home',
        'home-category',
        { defaultTrackingMode: 'FIVE_LEVEL' },
      ),
    ).toMatchObject({
      defaultTrackingMode: 'FIVE_LEVEL',
      defaultPrimaryUnit: null,
    });
    expect(
      await service.updateCategoryInventoryDefaults(
        'admin',
        'home',
        'home-category',
        { defaultPrimaryUnit: ' box ' },
      ),
    ).toMatchObject({
      defaultTrackingMode: 'FIVE_LEVEL',
      defaultPrimaryUnit: 'box',
    });
    expect(
      await service.updateCategoryInventoryDefaults(
        'admin',
        'home',
        'home-category',
        { defaultTrackingMode: null },
      ),
    ).toMatchObject({ defaultTrackingMode: null, defaultPrimaryUnit: 'box' });
    expect(
      await service.updateCategoryInventoryDefaults(
        'admin',
        'home',
        'home-category',
        { defaultPrimaryUnit: null },
      ),
    ).toMatchObject({ defaultTrackingMode: null, defaultPrimaryUnit: null });
  });

  it('rejects invalid modes, units, empty patches, and unknown fields without writing', async () => {
    const { service, prisma } = setup();
    for (const body of [
      {},
      { defaultTrackingMode: 'COUNT' },
      { defaultTrackingMode: 1 },
      { defaultPrimaryUnit: '' },
      { defaultPrimaryUnit: ' '.repeat(2) },
      { defaultPrimaryUnit: 'u'.repeat(41) },
      { defaultPrimaryUnit: 7 },
      { defaultTrackingMode: 'QUANTITY', name: 'Changed' },
    ])
      await expect(
        service.updateCategoryInventoryDefaults(
          'admin',
          'home',
          'home-category',
          body,
        ),
      ).rejects.toMatchObject({ status: 400 });
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('requires household Admin and scopes the category update to that household', async () => {
    const { service, prisma, categories } = setup();
    await expect(
      service.updateCategoryInventoryDefaults(
        'member',
        'home',
        'home-category',
        { defaultTrackingMode: 'QUANTITY' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateCategoryInventoryDefaults(
        'other-admin',
        'home',
        'home-category',
        { defaultPrimaryUnit: 'box' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.updateCategoryInventoryDefaults(
        'admin',
        'other',
        'other-category',
        { defaultPrimaryUnit: 'box' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.category.update).not.toHaveBeenCalled();
    expect(categories.get('other-category')?.defaultPrimaryUnit).toBeNull();
  });

  it('returns both defaults to household members through Category reads', async () => {
    const { service, categories } = setup();
    const category = categories.get('home-category')!;
    category.defaultTrackingMode = 'PRESENCE_BACKUP';
    category.defaultPrimaryUnit = 'bottle';
    await expect(service.list('member', 'home', 'categories')).resolves.toEqual(
      [
        {
          id: 'home-category',
          name: 'Pantry',
          shoppingSection: 'PANTRY',
          defaultTrackingMode: 'PRESENCE_BACKUP',
          defaultPrimaryUnit: 'bottle',
        },
      ],
    );
  });
});
