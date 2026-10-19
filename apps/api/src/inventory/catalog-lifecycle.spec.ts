import { Prisma } from '../generated/prisma/client.js';
import { CatalogService } from './catalog.service.js';

function setup(role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  const category = {
    id: 'category',
    householdId: 'home',
    name: 'Pantry',
    shoppingSection: 'PANTRY',
  };
  const location = { id: 'location', householdId: 'home', name: 'Shelf' };
  const tag = { id: 'tag', householdId: 'home', name: 'Staple' };
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ id: 'catalog' }])
      .mockResolvedValue([{ count: 0 }]),
    inventoryItem: { count: vi.fn().mockResolvedValue(0) },
    stockBatch: { count: vi.fn().mockResolvedValue(0) },
    shoppingEntry: { count: vi.fn().mockResolvedValue(0) },
    locationStockCheck: { count: vi.fn().mockResolvedValue(0) },
    category: { delete: vi.fn() },
    location: { delete: vi.fn() },
  };
  const prisma = {
    membership: { findUnique: vi.fn().mockResolvedValue({ role }) },
    category: {
      findFirst: vi.fn().mockResolvedValue(category),
      update: vi.fn(
        async ({ data }: { data: { name?: string; nameKey?: string } }) => ({
          ...category,
          ...data,
        }),
      ),
    },
    location: {
      findFirst: vi.fn().mockResolvedValue(location),
      update: vi.fn(async ({ data }: { data: { name: string } }) => ({
        ...location,
        ...data,
      })),
    },
    tag: {
      findFirst: vi.fn().mockResolvedValue(tag),
      update: vi.fn(async ({ data }: { data: { name: string } }) => ({
        ...tag,
        ...data,
      })),
    },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new CatalogService(prisma as never), prisma, tx };
}

describe('catalog rename and removal', () => {
  it('renames a category without changing its shopping section and retains section-only PATCH', async () => {
    const { service, prisma } = setup();
    expect(
      await service.updateCategory('admin', 'home', 'category', {
        name: '  Dry   Pantry  ',
      }),
    ).toMatchObject({ name: 'Dry Pantry', shoppingSection: 'PANTRY' });
    expect(prisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Dry Pantry', nameKey: 'dry pantry' },
      }),
    );
    expect(
      await service.updateCategory('admin', 'home', 'category', {
        shoppingSection: 'DAIRY',
      }),
    ).toMatchObject({ shoppingSection: 'DAIRY' });
    await expect(
      service.updateCategory('admin', 'home', 'category', {
        name: 'Other',
        shoppingSection: 'DAIRY',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('renames locations and tags, and same-name rename writes nothing', async () => {
    const { service, prisma } = setup();
    expect(
      await service.renameLocation('admin', 'home', 'location', {
        name: 'Cold Shelf',
      }),
    ).toMatchObject({
      name: 'Cold Shelf',
    });
    expect(
      await service.renameTag('admin', 'home', 'tag', { name: 'Every day' }),
    ).toMatchObject({
      name: 'Every day',
    });
    await service.renameCategory('admin', 'home', 'category', {
      name: 'Pantry',
    });
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('rejects Member, foreign ID, invalid name, and normalized duplicate', async () => {
    const member = setup('MEMBER');
    await expect(
      member.service.renameLocation('member', 'home', 'location', {
        name: 'New',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const admin = setup();
    admin.prisma.category.findFirst.mockResolvedValueOnce(null);
    await expect(
      admin.service.renameCategory('admin', 'home', 'foreign', { name: 'New' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      admin.service.renameTag('admin', 'home', 'tag', { name: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
    admin.prisma.location.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.10.0',
      }),
    );
    await expect(
      admin.service.renameLocation('admin', 'home', 'location', {
        name: 'Duplicate',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: 'CATALOG_NAME_EXISTS' },
    });
  });

  it('deletes only an unreferenced category or location', async () => {
    const category = setup();
    await category.service.removeCategory('admin', 'home', 'category');
    expect(category.tx.category.delete).toHaveBeenCalledWith({
      where: { id: 'category', householdId: 'home' },
    });
    const location = setup();
    await location.service.removeLocation('admin', 'home', 'location');
    expect(location.tx.location.delete).toHaveBeenCalledWith({
      where: { id: 'location', householdId: 'home' },
    });
  });

  it('blocks archived-item and zero-batch references with useful counts', async () => {
    const category = setup();
    category.tx.inventoryItem.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    await expect(
      category.service.removeCategory('admin', 'home', 'category'),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'CATEGORY_IN_USE',
        references: { activeItems: 0, archivedItems: 1, itemChanges: 0 },
      },
    });
    expect(category.tx.category.delete).not.toHaveBeenCalled();
    const location = setup();
    location.tx.stockBatch.count.mockResolvedValueOnce(1);
    await expect(
      location.service.removeLocation('admin', 'home', 'location'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'LOCATION_IN_USE', references: { batches: 1 } },
    });
    expect(location.tx.location.delete).not.toHaveBeenCalled();
  });

  it('blocks item-change JSON references after current assignments are cleared', async () => {
    const category = setup();
    category.tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'category' }])
      .mockResolvedValueOnce([{ count: 1 }]);
    await expect(
      category.service.removeCategory('admin', 'home', 'category'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CATEGORY_IN_USE', references: { itemChanges: 1 } },
    });
    const location = setup();
    location.tx.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: 'location' }])
      .mockResolvedValueOnce([{ count: 1 }]);
    await expect(
      location.service.removeLocation('admin', 'home', 'location'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'LOCATION_IN_USE', references: { itemChanges: 1 } },
    });
  });

  it('maps a concurrent foreign-key rejection to a controlled conflict', async () => {
    const { service, tx } = setup();
    tx.location.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: '7.10.0',
      }),
    );
    await expect(
      service.removeLocation('admin', 'home', 'location'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'LOCATION_IN_USE' },
    });
  });
});
