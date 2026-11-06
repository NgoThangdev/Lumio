import { describe, expect, it } from 'vitest';
import { parseAddItem } from './add-item-input.js';

const ids = { categoryId: 'category', locationId: 'location', tagIds: ['tag'] };

describe('atomic Add Item input', () => {
  it('keeps optional purchase and freeze dates only on a positive quantity batch', () => {
    const purchaseDate = new Date('2026-11-01T00:00:00.000Z');
    const freezeDate = new Date('2026-11-02T00:00:00.000Z');
    expect(
      parseAddItem('QUANTITY', {
        ...ids,
        initialStock: { quantity: '2', purchaseDate, freezeDate },
      }).initialStock,
    ).toMatchObject({ quantity: '2', purchaseDate, freezeDate });
    expect(() =>
      parseAddItem('QUANTITY', {
        ...ids,
        initialStock: { quantity: '0', purchaseDate },
      }),
    ).toThrow('cannot have batch dates');
    expect(() =>
      parseAddItem('FIVE_LEVEL', {
        ...ids,
        initialStock: { level: 'FULL', freezeDate },
      }),
    ).toThrow('only valid for quantity tracking');
  });
  it('accepts zero quantity without a batch requirement', () => {
    expect(
      parseAddItem('QUANTITY', { ...ids, initialStock: { quantity: '0' } })
        .initialStock,
    ).toEqual({ quantity: '0', expiryDate: null });
  });

  it('preserves positive decimal precision and rejects invalid stock shapes', () => {
    expect(
      parseAddItem('QUANTITY', {
        ...ids,
        initialStock: { quantity: '1.000001' },
      }).initialStock,
    ).toMatchObject({ quantity: '1.000001' });
    expect(() =>
      parseAddItem('QUANTITY', {
        ...ids,
        initialStock: { quantity: '1.0000001' },
      }),
    ).toThrow('six decimal places');
    expect(() =>
      parseAddItem('QUANTITY', {
        ...ids,
        initialStock: { quantity: '0', expiryDate: new Date() },
      }),
    ).toThrow('cannot have an expiry');
    expect(() =>
      parseAddItem('QUANTITY', { ...ids, initialStock: { level: 'FULL' } }),
    ).toThrow('requires an initial quantity');
  });

  it('validates five-level and presence states separately', () => {
    expect(
      parseAddItem('FIVE_LEVEL', {
        ...ids,
        initialStock: { level: 'QUARTER', backupCount: 2 },
      }).initialStock,
    ).toEqual({ level: 'QUARTER', backupCount: 2 });
    expect(
      parseAddItem('PRESENCE_BACKUP', {
        ...ids,
        initialStock: { present: false },
      }).initialStock,
    ).toEqual({ present: false, backupCount: 0 });
    expect(() =>
      parseAddItem('FIVE_LEVEL', {
        ...ids,
        initialStock: { level: 'ONE_THIRD' },
      }),
    ).toThrow('five stock levels');
    expect(() =>
      parseAddItem('PRESENCE_BACKUP', {
        ...ids,
        initialStock: { present: true, backupCount: -1 },
      }),
    ).toThrow('non-negative');
    expect(() =>
      parseAddItem('PRESENCE_BACKUP', {
        ...ids,
        initialStock: { present: 'yes' },
      }),
    ).toThrow('true or false');
  });

  it('requires classification, placement, and distinct tag IDs', () => {
    expect(() =>
      parseAddItem('QUANTITY', {
        locationId: 'location',
        initialStock: { quantity: '1' },
      }),
    ).toThrow('Category ID');
    expect(() =>
      parseAddItem('QUANTITY', {
        categoryId: 'category',
        initialStock: { quantity: '1' },
      }),
    ).toThrow('Location ID');
    expect(() =>
      parseAddItem('QUANTITY', {
        ...ids,
        tagIds: ['tag', 'tag'],
        initialStock: { quantity: '1' },
      }),
    ).toThrow('distinct IDs');
  });
});
