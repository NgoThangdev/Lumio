import { ShoppingService } from './shopping.service.js';

function setup() {
  const item = {
    id: 'item',
    name: 'Milk',
    primaryUnit: 'box',
    trackingMode: 'QUANTITY',
    openedTrackingEnabled: false,
    preferredRestockLocationId: null,
    preferredRestockLocation: null,
    category: {
      householdId: 'home',
      shoppingSection: 'DAIRY' as string | null,
    },
  };
  const entries = [
    {
      id: 'suggested',
      itemId: 'item',
      source: 'SUGGESTED',
      priority: 'MUST_BUY',
      status: 'PURCHASED',
      suggestedQuantity: '2',
      suggestedReason: 'Snapshot',
      actualQuantity: '3',
      item,
    },
    {
      id: 'uncategorized',
      itemId: 'other-item',
      source: 'MANUAL',
      priority: 'OPTIONAL',
      status: 'SKIPPED',
      suggestedQuantity: null,
      suggestedReason: null,
      actualQuantity: null,
      item: { ...item, id: 'other-item', category: null },
    },
  ];
  const trip = { id: 'trip', status: 'RESTOCKED', entries };
  const prisma = {
    membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'member' }) },
    shoppingTrip: { findFirst: vi.fn().mockResolvedValue(trip) },
    shoppingEntry: { update: vi.fn(), create: vi.fn() },
  };
  const service = new ShoppingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, item, entries };
}

describe('Shopping Trip live sections', () => {
  it('regroups on the next read without touching entry snapshots or purchase data', async () => {
    const { service, prisma, item, entries } = setup();
    const before = await service.read('member', 'home', 'trip');
    expect(before.entries.map((entry) => entry.shoppingSection)).toEqual([
      'DAIRY',
      'OTHER',
    ]);
    expect(before.entries[0].item).not.toHaveProperty('category');
    item.category.shoppingSection = 'DRINKS';
    const after = await service.read('member', 'home', 'trip');
    expect(after.entries.map((entry) => entry.shoppingSection)).toEqual([
      'DRINKS',
      'OTHER',
    ]);
    expect(after.entries[0]).toMatchObject({
      source: 'SUGGESTED',
      priority: 'MUST_BUY',
      status: 'PURCHASED',
      suggestedQuantity: '2',
      suggestedReason: 'Snapshot',
      actualQuantity: '3',
    });
    expect(entries[0].suggestedReason).toBe('Snapshot');
    expect(prisma.shoppingTrip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trip', householdId: 'home' },
        include: expect.objectContaining({
          entries: expect.objectContaining({
            include: expect.objectContaining({
              item: expect.objectContaining({
                select: expect.objectContaining({
                  category: {
                    select: { householdId: true, shoppingSection: true },
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(prisma.shoppingEntry.update).not.toHaveBeenCalled();
    expect(prisma.shoppingEntry.create).not.toHaveBeenCalled();
  });

  it('uses OTHER when a category is unmapped', async () => {
    const { service, item } = setup();
    item.category.shoppingSection = null;
    const trip = await service.read('member', 'home', 'trip');
    expect(trip.entries.map((entry) => entry.shoppingSection)).toEqual([
      'OTHER',
      'OTHER',
    ]);
  });

  it('does not use a foreign-household category mapping', async () => {
    const { service, item } = setup();
    item.category.householdId = 'other';
    expect(
      (await service.read('member', 'home', 'trip')).entries[0].shoppingSection,
    ).toBe('OTHER');
  });
});
