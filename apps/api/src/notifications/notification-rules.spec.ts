import { Prisma } from '../generated/prisma/browser.js';
import { assessItem } from '../inventory/stock-intelligence.js';
import { assessStateItem } from '../inventory/state-assessment.js';
import { localQuietEnd, notificationCandidates } from './notification-rules.js';

const at = new Date('2026-10-14T02:00:00.000Z');
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const decimal = (value: string) => new Prisma.Decimal(value);
const preference = {
  expiryAlertsEnabled: true,
  lowStockAlertsEnabled: true,
  dailyDigestEnabled: true,
  quietHoursStart: null,
  quietHoursEnd: null,
};

function quantity(
  id: string,
  options: {
    neverRunOut?: boolean;
    quantity?: string;
    expiry?: string;
    openedUseBy?: string;
    lowStockThreshold?: string;
  } = {},
) {
  return {
    ...assessItem(
      {
        id,
        name: id,
        primaryUnit: 'box',
        minimumStock: null,
        lowStockThreshold: options.lowStockThreshold
          ? decimal(options.lowStockThreshold)
          : null,
        buyThreshold: null,
        targetStock: null,
        openedTrackingEnabled: Boolean(options.openedUseBy),
        neverRunOut: options.neverRunOut ?? false,
        predictionEnabled: false,
        batches: options.quantity
          ? [
              {
                quantity: decimal(options.quantity),
                expiryDate: options.expiry ? day(options.expiry) : null,
                openedAt: options.openedUseBy ? at : null,
                openedUseByDate: options.openedUseBy
                  ? day(options.openedUseBy)
                  : null,
              },
            ]
          : [],
        actions: [],
      },
      at,
      '2026-10-21',
    ),
    trackingMode: 'QUANTITY' as const,
  };
}

describe('notification candidate rules', () => {
  it('keeps immediate urgent, digest aggregate, and ordinary activity passive', () => {
    const stateOut = assessStateItem({
      id: 'state-out',
      name: 'State',
      primaryUnit: 'bottle',
      trackingMode: 'FIVE_LEVEL',
      currentLevel: 'EMPTY',
      isPresent: null,
      backupCount: 0,
      lowAtLevel: 'HALF',
      buyAtLevel: 'QUARTER',
      neverRunOut: true,
    });
    const candidates = notificationCandidates(
      [
        {
          householdId: 'h2',
          assessments: [
            quantity('opened-today', {
              quantity: '1',
              expiry: '2026-10-30',
              openedUseBy: '2026-10-14',
            }),
            quantity('low', { quantity: '2', lowStockThreshold: '3' }),
          ],
        },
        {
          householdId: 'h1',
          assessments: [
            quantity('out', { neverRunOut: true }),
            quantity('soon', { quantity: '1', expiry: '2026-10-16' }),
            stateOut,
          ],
        },
      ],
      preference,
    );
    expect(
      candidates.filter((candidate) => candidate.kind === 'IMMEDIATE_ITEM'),
    ).toMatchObject([
      { householdId: 'h1', itemId: 'out', content: { signal: 'OUT' } },
      { householdId: 'h1', itemId: 'state-out', content: { signal: 'OUT' } },
      {
        householdId: 'h2',
        itemId: 'opened-today',
        content: { signal: 'USE_TODAY' },
      },
    ]);
    expect(
      candidates.find((candidate) => candidate.kind === 'DAILY_DIGEST')
        ?.content,
    ).toMatchObject({
      households: [
        {
          householdId: 'h1',
          items: [
            { itemId: 'out', signals: ['LOW_STOCK'] },
            { itemId: 'soon', signals: ['USE_SOON'] },
            { itemId: 'state-out', signals: ['LOW_STOCK'] },
          ],
        },
        {
          householdId: 'h2',
          items: [
            { itemId: 'low', signals: ['LOW_STOCK'] },
            { itemId: 'opened-today', signals: ['USE_SOON'] },
          ],
        },
      ],
    });
    expect(
      notificationCandidates(
        [
          {
            householdId: 'h1',
            assessments: [quantity('out', { neverRunOut: true })],
          },
        ],
        {
          ...preference,
          lowStockAlertsEnabled: false,
          expiryAlertsEnabled: false,
        },
      ),
    ).toEqual([]);
  });

  it('defers within quiet hours using inclusive start and exclusive end in Ho Chi Minh City', () => {
    const quiet = {
      ...preference,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    };
    expect(
      localQuietEnd(new Date('2026-10-14T15:00:00.000Z'), quiet)?.toISOString(),
    ).toBe('2026-10-15T00:00:00.000Z');
    expect(
      localQuietEnd(new Date('2026-10-14T23:59:00.000Z'), quiet)?.toISOString(),
    ).toBe('2026-10-15T00:00:00.000Z');
    expect(
      localQuietEnd(new Date('2026-10-15T00:00:00.000Z'), quiet),
    ).toBeNull();
    expect(
      localQuietEnd(new Date('2026-10-14T04:00:00.000Z'), {
        ...preference,
        quietHoursStart: '10:00',
        quietHoursEnd: '12:00',
      })?.toISOString(),
    ).toBe('2026-10-14T05:00:00.000Z');
  });
});
