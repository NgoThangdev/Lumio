import { Prisma } from '../generated/prisma/browser.js';
import {
  parseDefaultUpdate,
  resolveQuantityDefaults,
} from './inventory-defaults.js';

const d = (value: string) => new Prisma.Decimal(value);
const household = {
  defaultTrackingMode: 'QUANTITY',
  defaultPrimaryUnit: 'box',
  defaultLowStockThreshold: d('4'),
  defaultBuyThreshold: d('2'),
  defaultTargetStock: d('8'),
  defaultSafetyBuffer: d('1.2'),
  defaultExpiryReminderDays: 3,
};
const category = {
  defaultTrackingMode: null,
  defaultPrimaryUnit: null,
  defaultLowStockThreshold: d('5'),
  defaultBuyThreshold: d('3'),
  defaultTargetStock: d('9'),
  defaultSafetyBuffer: d('1.5'),
  defaultExpiryReminderDays: 5,
};

describe('new item inventory defaults', () => {
  it('uses compatible category overrides, then household values', () => {
    const result = resolveQuantityDefaults('QUANTITY', 'box', household, {
      ...category,
      defaultBuyThreshold: null,
    });
    expect(result.lowStockThreshold?.toString()).toBe('5');
    expect(result.buyThreshold?.toString()).toBe('2');
    expect(result.targetStock?.toString()).toBe('9');
    expect(result.safetyBuffer.toString()).toBe('1.5');
    expect(result.expiryReminderDays).toBe(5);
  });

  it('does not copy numeric thresholds across a different unit or tracking mode', () => {
    expect(
      resolveQuantityDefaults('QUANTITY', 'kg', household, category)
        .lowStockThreshold,
    ).toBeNull();
    expect(
      resolveQuantityDefaults('FIVE_LEVEL', 'box', household, category)
        .buyThreshold,
    ).toBeNull();
  });

  it('rejects invalid default input and inverted thresholds', () => {
    expect(() =>
      parseDefaultUpdate({ defaultSafetyBuffer: '1.234' }),
    ).toThrow();
    expect(() =>
      parseDefaultUpdate({ defaultExpiryReminderDays: 31 }),
    ).toThrow();
    expect(() =>
      resolveQuantityDefaults('QUANTITY', 'box', household, {
        ...category,
        defaultBuyThreshold: d('6'),
      }),
    ).toThrow();
  });
});
