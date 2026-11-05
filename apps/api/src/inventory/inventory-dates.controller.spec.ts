import { InventoryController } from './inventory.controller.js';

describe('inventory batch date requests', () => {
  it('rejects invalid purchase and freeze calendar dates before a stock write', () => {
    const createItem = vi.fn();
    const restockQuantity = vi.fn();
    const controller = new InventoryController(
      { createItem, restockQuantity } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const request = { actorId: 'actor' } as never;
    expect(() =>
      controller.create(request, 'house', {
        name: 'Milk',
        primaryUnit: 'box',
        initialStock: { quantity: '1', purchaseDate: '2026-02-30' },
      }),
    ).toThrow('Purchase date must be a valid calendar date');
    expect(() =>
      controller.restock(request, 'house', 'item', {
        quantity: '1',
        freezeDate: 'yesterday',
      }),
    ).toThrow('Freeze date must be YYYY-MM-DD');
    expect(createItem).not.toHaveBeenCalled();
    expect(restockQuantity).not.toHaveBeenCalled();
  });
});
