import { Prisma } from '../generated/prisma/client.js';
import { ShoppingService } from './shopping.service.js';

describe('Shopping suggestion import', () => {
  it('assesses through the locked transaction after a correction commits', async () => {
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      lockRequested = resolve;
    });
    let stock = 3;
    const createMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
        expect(sql.join('')).toContain('FOR UPDATE');
        lockRequested();
        await locked;
        return [
          {
            status: 'DRAFT',
            plannedDate: new Date('2026-10-20'),
            suggestionsImportedAt: null,
          },
        ];
      }),
      shoppingEntry: { createMany, findFirst: vi.fn().mockResolvedValue(null) },
      shoppingTrip: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
      inventoryItem: { findMany: vi.fn() },
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      shoppingTrip: {
        findFirst: vi.fn().mockResolvedValue({ id: 'trip', entries: [] }),
      },
    };
    const intelligence = {
      assessInTransaction: vi.fn(async (client: unknown) => {
        expect(client).toBe(tx);
        return {
          suggestions: [
            {
              itemId: 'item',
              suggestion: {
                quantity: 10 - stock,
                priority: 'MUST_BUY',
                reason: 'Below target',
              },
            },
          ],
          assessments: [],
        };
      }),
    };
    const service = new ShoppingService(
      prisma as never,
      {} as never,
      {} as never,
      intelligence as never,
    );

    const importing = service.importSuggestions('user', 'household', 'trip');
    await requested;
    expect(intelligence.assessInTransaction).not.toHaveBeenCalled();
    stock = 8;
    releaseLock();
    await importing;

    expect(intelligence.assessInTransaction).toHaveBeenCalledWith(
      tx,
      'user',
      'household',
      '2026-10-20',
    );
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ itemId: 'item', suggestedQuantity: 2 })],
      skipDuplicates: true,
    });
  });

  it('adds skipped context to normal buys and Optional gaps only for the immediately previous trip', async () => {
    const createMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          status: 'DRAFT',
          plannedDate: new Date('2026-10-20'),
          suggestionsImportedAt: null,
        },
      ]),
      shoppingEntry: { findFirst: vi.fn().mockResolvedValue(null), createMany },
      shoppingTrip: {
        findFirst: vi.fn().mockResolvedValue({
          entries: [
            { itemId: 'normal' },
            { itemId: 'optional' },
            { itemId: 'recovered' },
            { itemId: 'expiring' },
            { itemId: 'untargeted' },
            { itemId: 'packageOptional' },
            { itemId: 'wholePackageOptional' },
            { itemId: 'fractionalOptional' },
            { itemId: 'five' },
            { itemId: 'presence' },
          ],
        }),
        updateMany: vi.fn(),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'optional',
            targetStock: new Prisma.Decimal(10),
            openedTrackingEnabled: false,
            batches: [
              {
                quantity: new Prisma.Decimal(6),
                expiryDate: null,
                openedAt: null,
                openedUseByDate: null,
              },
            ],
          },
          {
            id: 'recovered',
            targetStock: new Prisma.Decimal(5),
            openedTrackingEnabled: false,
            batches: [
              {
                quantity: new Prisma.Decimal(5),
                expiryDate: null,
                openedAt: null,
                openedUseByDate: null,
              },
            ],
          },
          {
            id: 'expiring',
            targetStock: new Prisma.Decimal(10),
            openedTrackingEnabled: false,
            batches: [
              {
                quantity: new Prisma.Decimal(6),
                expiryDate: new Date('2026-10-19'),
                openedAt: null,
                openedUseByDate: null,
              },
            ],
          },
          {
            id: 'untargeted',
            targetStock: null,
            openedTrackingEnabled: false,
            batches: [],
          },
          {
            id: 'packageOptional',
            targetStock: new Prisma.Decimal(2),
            openedTrackingEnabled: true,
            batches: [
              {
                quantity: new Prisma.Decimal(1),
                expiryDate: null,
                openedAt: null,
                openedUseByDate: null,
              },
              {
                quantity: new Prisma.Decimal('0.5'),
                expiryDate: null,
                openedAt: new Date('2026-10-14'),
                openedUseByDate: null,
              },
            ],
          },
          {
            id: 'wholePackageOptional',
            targetStock: new Prisma.Decimal(2),
            openedTrackingEnabled: true,
            batches: [
              {
                quantity: new Prisma.Decimal(1),
                expiryDate: null,
                openedAt: null,
                openedUseByDate: null,
              },
            ],
          },
          {
            id: 'fractionalOptional',
            targetStock: new Prisma.Decimal(2),
            openedTrackingEnabled: false,
            batches: [
              {
                quantity: new Prisma.Decimal('1.5'),
                expiryDate: null,
                openedAt: null,
                openedUseByDate: null,
              },
            ],
          },
        ]),
      },
    };
    const quantity = (
      itemId: string,
      eligibleStock: string,
      suggestion: unknown = null,
    ) => ({
      itemId,
      primaryUnit: 'box',
      eligibleStock,
      suggestion,
    });
    const state = (itemId: string, recommendedAction: string) => ({
      itemId,
      purchasePriority: 'SHOULD_BUY',
      recommendedAction,
      reasons: ['Current state.', 'Buy a backup.'],
      suggestion: null,
    });
    const intelligence = {
      assessInTransaction: vi.fn().mockResolvedValue({
        suggestions: [
          quantity('normal', '2', {
            quantity: '8',
            priority: 'MUST_BUY',
            reason: 'Current buy risk.',
          }),
        ],
        assessments: [
          quantity('normal', '2', {
            quantity: '8',
            priority: 'MUST_BUY',
            reason: 'Current buy risk.',
          }),
          quantity('optional', '6'),
          quantity('recovered', '5'),
          quantity('expiring', '6'),
          quantity('untargeted', '0'),
          quantity('packageOptional', '1.5'),
          quantity('wholePackageOptional', '1'),
          quantity('fractionalOptional', '1.5'),
          state('five', 'BUY_BACKUP'),
          state('presence', 'NONE'),
        ],
      }),
    };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      shoppingTrip: {
        findFirst: vi.fn().mockResolvedValue({ id: 'trip', entries: [] }),
      },
    };
    const service = new ShoppingService(
      prisma as never,
      {} as never,
      {} as never,
      intelligence as never,
    );
    await service.importSuggestions('user', 'household', 'trip');

    expect(tx.shoppingTrip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: 'household',
          status: 'RESTOCKED',
          plannedDate: { lte: new Date('2026-10-20') },
        }),
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(7);
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'normal',
          priority: 'MUST_BUY',
          suggestedQuantity: '8',
          suggestedReason: expect.stringContaining(
            'Skipped on the previous trip.',
          ),
        }),
        expect.objectContaining({
          itemId: 'optional',
          priority: 'OPTIONAL',
          suggestedQuantity: '4',
        }),
        expect.objectContaining({
          itemId: 'five',
          priority: 'SHOULD_BUY',
          suggestedQuantity: null,
          suggestedReason: expect.stringContaining(
            'Skipped on the previous trip.',
          ),
        }),
        expect.objectContaining({
          itemId: 'expiring',
          priority: 'OPTIONAL',
          suggestedQuantity: '10',
        }),
        expect.objectContaining({
          itemId: 'packageOptional',
          priority: 'OPTIONAL',
          suggestedQuantity: '1',
          suggestedReason: expect.stringContaining(
            'Buy 1 box to meet or exceed the target of 2.',
          ),
        }),
        expect.objectContaining({
          itemId: 'wholePackageOptional',
          suggestedQuantity: '1',
        }),
        expect.objectContaining({
          itemId: 'fractionalOptional',
          suggestedQuantity: '0.5',
          suggestedReason: expect.stringContaining(
            'Buy 0.5 box to reach the target of 2.',
          ),
        }),
      ]),
    );
  });

  it('does not assess or insert again after a zero-entry import or for a legacy suggested draft', async () => {
    const createMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          status: 'DRAFT',
          plannedDate: new Date('2026-10-20'),
          suggestionsImportedAt: new Date(),
        },
      ]),
      shoppingEntry: { findFirst: vi.fn().mockResolvedValue(null), createMany },
      shoppingTrip: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      inventoryItem: { findMany: vi.fn() },
    };
    const intelligence = { assessInTransaction: vi.fn() };
    const prisma = {
      membership: { findUnique: vi.fn().mockResolvedValue({ userId: 'user' }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
      shoppingTrip: {
        findFirst: vi.fn().mockResolvedValue({ id: 'trip', entries: [] }),
      },
    };
    const service = new ShoppingService(
      prisma as never,
      {} as never,
      {} as never,
      intelligence as never,
    );
    await service.importSuggestions('user', 'household', 'trip');
    expect(intelligence.assessInTransaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();

    tx.$queryRaw.mockResolvedValue([
      {
        status: 'DRAFT',
        plannedDate: new Date('2026-10-20'),
        suggestionsImportedAt: null,
      },
    ]);
    tx.shoppingEntry.findFirst.mockResolvedValue({ id: 'legacy' });
    await service.importSuggestions('user', 'household', 'trip');
    expect(tx.shoppingTrip.update).toHaveBeenCalledOnce();
    expect(intelligence.assessInTransaction).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
