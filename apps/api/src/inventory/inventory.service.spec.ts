import { InventoryService } from './inventory.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('InventoryService quantity validation', () => {
  it('rejects an over-range Use quantity before opening a transaction', async () => {
    const transaction = vi.fn();
    const service = new InventoryService({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(
      service.useQuantity({
        actorId: 'actor',
        householdId: 'household',
        itemId: 'item',
        quantity: '1000000000000',
      }),
    ).rejects.toThrow('Decimal(18,6) maximum of 999999999999.999999');
    expect(transaction).not.toHaveBeenCalled();
  });
});
