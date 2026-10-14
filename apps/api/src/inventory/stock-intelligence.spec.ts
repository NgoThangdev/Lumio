import { Prisma } from '../generated/prisma/browser.js';
import { assessItem, IntelligenceItem } from './stock-intelligence.js';

const d = (value: string) => new Prisma.Decimal(value);
const at = new Date('2026-10-09T03:00:00.000Z'); // 10:00 in Ho Chi Minh City
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

function item(overrides: Partial<IntelligenceItem> = {}): IntelligenceItem {
  return {
    id: 'item',
    name: 'Eggs',
    primaryUnit: 'egg',
    minimumStock: null,
    lowStockThreshold: null,
    buyThreshold: null,
    targetStock: null,
    openedTrackingEnabled: false,
    neverRunOut: false,
    predictionEnabled: false,
    batches: [],
    actions: [],
    ...overrides,
  };
}

describe('quantity stock intelligence', () => {
  it('counts Finish opened as consumption and uses opening expiry for Use Soon', () => {
    const result = assessItem(
      item({
        predictionEnabled: true,
        batches: [
          {
            quantity: d('0.5'),
            expiryDate: date('2026-10-30'),
            openedAt: at,
            openedUseByDate: date('2026-10-10'),
          },
        ],
        actions: [
          {
            type: 'USE',
            quantity: d('1'),
            createdAt: new Date('2026-10-01T03:00:00.000Z'),
          },
          {
            type: 'FINISH_OPENED',
            quantity: d('0.5'),
            createdAt: new Date('2026-10-08T03:00:00.000Z'),
          },
          {
            type: 'OPEN',
            quantity: d('1'),
            createdAt: new Date('2026-10-08T04:00:00.000Z'),
          },
        ],
      }),
      at,
      '2026-10-15',
    );
    expect(result).toMatchObject({
      openedQuantity: '0.5',
      unopenedQuantity: '0',
      useSoonQuantity: '0.5',
      expiryRisk: 'USE_SOON',
    });
    expect(result.prediction.usedIn14Days).toBe('1.5');
  });
  it('uses 14-day USE quantities and a 20% buffer for a forecast shortage', () => {
    const result = assessItem(
      item({
        predictionEnabled: true,
        targetStock: d('24'),
        batches: [{ quantity: d('7'), expiryDate: null }],
        actions: [
          { quantity: d('8'), createdAt: new Date('2026-10-01T03:00:00.000Z') },
          { quantity: d('6'), createdAt: new Date('2026-10-08T03:00:00.000Z') },
          {
            quantity: d('100'),
            createdAt: new Date('2026-09-20T03:00:00.000Z'),
          },
        ],
      }),
      at,
      '2026-10-15',
    );
    expect(result.prediction).toMatchObject({
      basis: 'USE_14_DAY',
      usedIn14Days: '14',
      dailyRate: '1',
      projectedNeed: '7.2',
      shoppingDays: 6,
    });
    expect(result.lowStockRisk).toBe('BUY');
    expect(result.suggestion?.quantity).toBe('17');
  });

  it('falls back to thresholds when USE history does not span seven days', () => {
    const result = assessItem(
      item({
        predictionEnabled: true,
        buyThreshold: d('6'),
        targetStock: d('24'),
        batches: [{ quantity: d('5'), expiryDate: null }],
        actions: [
          {
            quantity: d('10'),
            createdAt: new Date('2026-10-08T03:00:00.000Z'),
          },
        ],
      }),
      at,
      '2026-10-15',
    );
    expect(result.prediction.basis).toBe('THRESHOLD_FALLBACK');
    expect(result.prediction.projectedNeed).toBeNull();
    expect(result.lowStockRisk).toBe('BUY');
    expect(result.suggestion?.quantity).toBe('19');
    expect(result.suggestion?.reason).toContain('target of 24');
  });

  it('keeps expiry risk separate from buy risk and distinguishes physical from eligible stock', () => {
    const result = assessItem(
      item({
        buyThreshold: d('2'),
        targetStock: d('12'),
        batches: [
          { quantity: d('3'), expiryDate: date('2026-10-10') },
          { quantity: d('5'), expiryDate: null },
          { quantity: d('2'), expiryDate: date('2026-10-08') },
        ],
      }),
      at,
      '2026-10-15',
    );
    expect(result).toMatchObject({
      physicalStock: '10',
      eligibleStock: '8',
      expiredStock: '2',
      useSoonQuantity: '3',
      expiryRisk: 'USE_SOON',
      lowStockRisk: 'OK',
      suggestion: null,
    });
  });

  it('keeps a batch eligible through its Ho Chi Minh expiry day', () => {
    const input = item({
      batches: [{ quantity: d('1.000001'), expiryDate: date('2026-10-09') }],
    });
    expect(
      assessItem(input, new Date('2026-10-09T16:00:00.000Z'), '2026-10-09')
        .eligibleStock,
    ).toBe('1.000001');
    expect(
      assessItem(input, new Date('2026-10-09T17:01:00.000Z'), '2026-10-10')
        .eligibleStock,
    ).toBe('0');
  });

  it('marks never-run-out stock at its minimum as Must Buy', () => {
    const result = assessItem(
      item({
        minimumStock: d('2'),
        targetStock: d('8'),
        neverRunOut: true,
        batches: [{ quantity: d('2'), expiryDate: null }],
      }),
      at,
      '2026-10-15',
    );
    expect(result.suggestion).toMatchObject({
      quantity: '6',
      priority: 'MUST_BUY',
    });
  });

  it('shows low stock without a purchase when only the low threshold is reached', () => {
    const result = assessItem(
      item({
        buyThreshold: d('2'),
        lowStockThreshold: d('5'),
        targetStock: d('12'),
        batches: [{ quantity: d('4'), expiryDate: null }],
      }),
      at,
      '2026-10-15',
    );
    expect(result.lowStockRisk).toBe('LOW');
    expect(result.suggestion).toBeNull();
  });

  it('suggests whole containers for opened tracking and retains ordinary fractional quantities', () => {
    const base = {
      buyThreshold: d('1.5'),
      targetStock: d('2'),
      batches: [
        { quantity: d('1'), expiryDate: null },
        { quantity: d('0.5'), expiryDate: null, openedAt: at },
      ],
    };
    const opened = assessItem(
      item({ ...base, primaryUnit: 'box', openedTrackingEnabled: true }),
      at,
      '2026-10-15',
    );
    expect(opened.suggestion?.quantity).toBe('1');
    expect(opened.suggestion?.reason).toContain(
      'Buy 1 box to meet or exceed the target of 2.',
    );

    const ordinary = assessItem(
      item({ ...base, batches: [{ quantity: d('1.5'), expiryDate: null }] }),
      at,
      '2026-10-15',
    );
    expect(ordinary.suggestion?.quantity).toBe('0.5');
    expect(ordinary.suggestion?.reason).toContain(
      'Buy 0.5 egg to reach the target of 2.',
    );

    const wholeGap = assessItem(
      item({
        ...base,
        primaryUnit: 'box',
        openedTrackingEnabled: true,
        batches: [{ quantity: d('1'), expiryDate: null }],
      }),
      at,
      '2026-10-15',
    );
    expect(wholeGap.suggestion?.quantity).toBe('1');
    expect(wholeGap.suggestion?.reason).toContain(
      'Buy 1 box to meet or exceed the target of 2.',
    );
  });
});
