import { resolveRestockLocation } from './stock-location.js';

function transaction(input?: {
  validLocationId?: string;
  legacyLocationId?: string;
}) {
  return {
    location: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === (input?.validLocationId ?? 'pantry')
          ? { id: where.id }
          : null,
      ),
    },
    stockBatch: {
      findFirst: vi.fn(async () =>
        input?.legacyLocationId ? { locationId: input.legacyLocationId } : null,
      ),
    },
    inventoryItem: { update: vi.fn(async () => ({})) },
  };
}

const scope = { householdId: 'household', itemId: 'item' };

describe('resolveRestockLocation', () => {
  it('uses a validated explicit location before the item default', async () => {
    const tx = transaction({ validLocationId: 'override' });
    await expect(
      resolveRestockLocation(tx as never, {
        ...scope,
        explicitLocationId: 'override',
        preferredLocationId: 'pantry',
      }),
    ).resolves.toBe('override');
    expect(tx.stockBatch.findFirst).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'item' },
      data: { preferredRestockLocationId: 'override' },
    });
  });

  it('uses the preferred location for an item with zero stock', async () => {
    const tx = transaction();
    await expect(
      resolveRestockLocation(tx as never, {
        ...scope,
        preferredLocationId: 'pantry',
      }),
    ).resolves.toBe('pantry');
    expect(tx.stockBatch.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a location that is not owned by the URL household', async () => {
    const tx = transaction({ validLocationId: 'household-location' });
    await expect(
      resolveRestockLocation(tx as never, {
        ...scope,
        explicitLocationId: 'foreign-location',
        preferredLocationId: null,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'LOCATION_NOT_FOUND',
        itemId: 'item',
      }),
    });
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('uses the latest located batch for this item when no preference exists', async () => {
    const tx = transaction({ legacyLocationId: 'pantry' });
    await expect(
      resolveRestockLocation(tx as never, {
        ...scope,
        preferredLocationId: null,
      }),
    ).resolves.toBe('pantry');
    expect(tx.stockBatch.findFirst).toHaveBeenCalledWith({
      where: {
        itemId: 'item',
        locationId: { not: null },
        location: { householdId: 'household' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { locationId: true },
    });
  });

  it('returns LOCATION_REQUIRED without changing item defaults when no location exists', async () => {
    const tx = transaction();
    await expect(
      resolveRestockLocation(tx as never, {
        ...scope,
        preferredLocationId: null,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LOCATION_REQUIRED' }),
    });
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
  });
});
