import { InventoryItemLifecycleService } from './inventory-item-lifecycle.service.js';

function setup(role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  const item = {
    id: 'item',
    name: 'Milk',
    categoryId: 'category',
    preferredRestockLocationId: 'shelf',
    archivedAt: null as Date | null,
    stockRevision: 9,
    tagLinks: [{ tagId: 'tag-a' }],
  };
  const tx = {
    membership: { findUnique: vi.fn().mockResolvedValue({ role }) },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'item' }]),
    inventoryItem: {
      findUniqueOrThrow: vi.fn(async () => item),
      delete: vi.fn(),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(item, data);
        return item;
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    category: { findFirst: vi.fn().mockResolvedValue({ id: 'category' }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: 'shelf' }) },
    tag: { count: vi.fn().mockResolvedValue(1) },
    inventoryItemTag: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    inventoryItemChange: { create: vi.fn(), deleteMany: vi.fn() },
    shoppingEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    tripStockCheck: { count: vi.fn().mockResolvedValue(0) },
    locationStockCheck: { count: vi.fn().mockResolvedValue(0) },
    inventoryUndo: { count: vi.fn().mockResolvedValue(0) },
    inventoryAction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    inventoryStateAction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    stockBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    actionBatchAllocation: {
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn(),
    },
    openTransfer: { count: vi.fn().mockResolvedValue(0) },
    notificationIntent: {
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
      update: vi.fn(),
    },
    notificationDelivery: { count: vi.fn().mockResolvedValue(0) },
  };
  const prisma = {
    $transaction: vi.fn((fn: (tx: typeof tx) => unknown) => fn(tx)),
  };
  const inventory = { readItem: vi.fn().mockResolvedValue({ id: 'item' }) };
  return {
    service: new InventoryItemLifecycleService(
      prisma as never,
      inventory as never,
    ),
    tx,
    item,
    inventory,
  };
}

describe('Inventory item metadata and lifecycle', () => {
  it('edits only supplied metadata and records before/after without touching stock revision', async () => {
    const { service, tx, item } = setup();
    await service.edit('admin', 'home', 'item', { name: 'Fresh Milk' });
    expect(item.name).toBe('Fresh Milk');
    expect(item.categoryId).toBe('category');
    expect(item.stockRevision).toBe(9);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'item' },
      data: {
        name: 'Fresh Milk',
        categoryId: 'category',
        preferredRestockLocationId: 'shelf',
      },
    });
    expect(tx.inventoryItemTag.deleteMany).not.toHaveBeenCalled();
    expect(tx.inventoryItemChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin',
        kind: 'EDIT',
        before: expect.objectContaining({ name: 'Milk' }),
        after: expect.objectContaining({ name: 'Fresh Milk' }),
      }),
    });
  });

  it('clears nullable metadata and tags but rejects stock fields', async () => {
    const { service, tx } = setup();
    await service.edit('admin', 'home', 'item', {
      categoryId: null,
      preferredRestockLocationId: null,
      tagIds: [],
    });
    expect(tx.inventoryItemTag.deleteMany).toHaveBeenCalledOnce();
    expect(tx.inventoryItemTag.createMany).not.toHaveBeenCalled();
    expect(tx.inventoryItemChange.create).toHaveBeenCalledOnce();
    await expect(
      service.edit('admin', 'home', 'item', { primaryUnit: 'bottle' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.edit('admin', 'home', 'item', { stockRevision: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects foreign references and Member writes', async () => {
    const admin = setup();
    admin.tx.category.findFirst.mockResolvedValue(null);
    await expect(
      admin.service.edit('admin', 'home', 'item', { categoryId: 'foreign' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(admin.tx.inventoryItem.update).not.toHaveBeenCalled();
    const member = setup('MEMBER');
    await expect(
      member.service.archive('member', 'home', 'item'),
    ).rejects.toMatchObject({ status: 403 });
    expect(member.tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('returns every active-trip blocker without changing the item', async () => {
    const { service, tx } = setup();
    tx.shoppingEntry.findMany.mockResolvedValue([
      { tripId: 'draft' },
      { tripId: 'shopping' },
    ]);
    await expect(
      service.archive('admin', 'home', 'item'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ACTIVE_TRIP_ENTRY', tripIds: ['draft', 'shopping'] },
    });
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('archives and restores without changing revision or deleting stock/history', async () => {
    const { service, tx, item } = setup();
    await service.archive('admin', 'home', 'item');
    expect(item.archivedAt).toBeInstanceOf(Date);
    expect(item.stockRevision).toBe(9);
    await service.archive('admin', 'home', 'item');
    await service.restore('admin', 'home', 'item');
    expect(item.archivedAt).toBeNull();
    await service.restore('admin', 'home', 'item');
    expect(tx.inventoryItemChange.create).toHaveBeenCalledTimes(2);
    expect(tx.inventoryItemChange.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'RESTORE' }),
      }),
    );
  });

  it('deletes only an archived item after exact-name confirmation', async () => {
    const { service, tx, item } = setup();
    item.archivedAt = new Date();
    await service.permanentlyDelete('admin', 'home', 'item', {
      confirmName: 'Milk',
    });
    expect(tx.inventoryItem.delete).toHaveBeenCalledWith({
      where: { id: 'item' },
    });
    expect(tx.inventoryItemChange.deleteMany).toHaveBeenCalledWith({
      where: { itemId: 'item' },
    });
    expect(tx.stockBatch.deleteMany).toHaveBeenCalledWith({
      where: { itemId: 'item' },
    });
  });

  it('rejects a Member, unarchived item, wrong name, and each history blocker', async () => {
    const member = setup('MEMBER');
    member.item.archivedAt = new Date();
    await expect(
      member.service.permanentlyDelete('member', 'home', 'item', {
        confirmName: 'Milk',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const { service, tx, item } = setup();
    await expect(
      service.permanentlyDelete('admin', 'home', 'item', {
        confirmName: 'Milk',
      }),
    ).rejects.toMatchObject({ status: 409 });
    item.archivedAt = new Date();
    await expect(
      service.permanentlyDelete('admin', 'home', 'item', {
        confirmName: 'milk',
      }),
    ).rejects.toMatchObject({ status: 400 });
    for (const [table, code] of [
      ['shoppingEntry', 'ITEM_HAS_SHOPPING_ENTRY'],
      ['tripStockCheck', 'ITEM_HAS_STOCK_CHECK'],
      ['locationStockCheck', 'ITEM_HAS_STOCK_CHECK'],
      ['inventoryUndo', 'ITEM_HAS_UNDO'],
      ['inventoryAction', 'ITEM_HAS_STOCK_ACTION'],
      ['inventoryStateAction', 'ITEM_HAS_STOCK_ACTION'],
    ] as const) {
      tx[table].count.mockResolvedValueOnce(1);
      await expect(
        service.permanentlyDelete('admin', 'home', 'item', {
          confirmName: 'Milk',
        }),
      ).rejects.toMatchObject({ status: 409, response: { message: code } });
    }
    expect(tx.inventoryItem.delete).not.toHaveBeenCalled();
  });
});
