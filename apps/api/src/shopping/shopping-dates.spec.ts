vi.mock('../households/active-household.js', () => ({
  checkActiveHousehold: vi.fn(),
  requireActiveHousehold: vi.fn(),
}));

import { Prisma } from '../generated/prisma/browser.js';
import { localCalendarDate } from '../inventory/plan-use.js';
import { ShoppingService } from './shopping.service.js';

describe('Shopping Finish batch dates', () => {
  it('defaults purchase date to today and preserves a chosen freeze date', async () => {
    const freezeDate = new Date('2026-11-01T00:00:00.000Z');
    const restockInTransaction = vi.fn();
    const update = vi.fn();
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ status: 'SHOPPING', archivedAt: null }]),
      shoppingEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'entry',
            itemId: 'item',
            status: 'PURCHASED',
            actualQuantity: new Prisma.Decimal('2'),
            expiryDate: null,
            purchaseDate: null,
            freezeDate,
            locationId: 'pantry',
            item: { trackingMode: 'QUANTITY' },
          },
        ]),
        update,
        updateMany: vi.fn(),
      },
      shoppingTrip: {
        update: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({ id: 'trip', entries: [] }),
      },
    };
    const prisma = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ userId: 'actor' }),
      },
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    };
    const service = new ShoppingService(
      prisma as never,
      { restockInTransaction } as never,
      {} as never,
      {} as never,
    );
    await service.finish('actor', 'house', 'trip');
    const today = localCalendarDate(new Date());
    expect(restockInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        purchaseDate: new Date(`${today}T00:00:00.000Z`),
        freezeDate,
      }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'entry' },
      data: { purchaseDate: new Date(`${today}T00:00:00.000Z`) },
    });
  });
});
