# Five-level and presence/backup backend slice

This records the original backend state-model slice. Its deferred Shopping/UI notes are historical; use the current Inventory and Shopping API contracts and source for the complete implementation.

## State model

`InventoryItem.trackingMode` is `QUANTITY`, `FIVE_LEVEL`, or `PRESENCE_BACKUP`. Existing rows default to `QUANTITY`; their batches, FEFO Use, quantity intelligence, and Shopping Trip restock remain the quantity path. Five-level and presence items use `currentLevel` or `isPresent`, plus an integer `backupCount`. They do not create fractional quantity batches. Database checks require nonnegative backups and a valid state shape for each mode.

Five-level items start `EMPTY` with zero backups. A level is exactly `FULL`, `THREE_QUARTERS`, `HALF`, `QUARTER`, or `EMPTY`. Presence/backup items start absent with zero backups. `isPresent` means one current usable item is available; `backupCount` counts unopened or spare items. These are technical initialization and presence semantics for this slice, not rules prescribed by the master prompt.

Every state action locks the item row, changes state and inserts `InventoryStateAction` in one transaction. Each record has the actor, action type, timestamp, and before/after level, presence, and backup count. An unchanged update is rejected. `OPEN_REFILL` requires `EMPTY` for five-level or absent for presence, plus at least one backup; it makes the current item `FULL` or present and subtracts one backup. A second or concurrent open cannot consume that backup again. State actions create no `InventoryAction`, `StockBatch`, or quantity allocation.

## Assessment rules

Default five-level low threshold is `HALF`; buy threshold is `QUARTER`. An Admin can configure both levels and `neverRunOut`. The buy threshold must be at or below the low threshold. With a backup, a nonempty current container is `OK`, regardless of its level. An empty/absent current item with backup is `LOW` with `OPEN_REFILL`, not a purchase. Without backup, an empty/absent item is `OUT` and needs a backup purchase. Without backup, a five-level item at or below the buy threshold is `BUY`; one at or below the low threshold is `LOW`. A present presence/backup item with zero backup is `BUY` when `neverRunOut` is true, otherwise `LOW`. `neverRunOut` raises a buy recommendation to `MUST_BUY`. These are deliberately small technical defaults for this first implementation.

No purchase quantity is inferred for these modes. The assessment gives `recommendedAction`, `purchasePriority`, and reasons, while `suggestion` remains null until mode-specific shopping is implemented. Quantity assessments retain their 14-day USE-only forecast, threshold fallback, expiry rules, and target-stock suggestions.

## HTTP contract for the frontend

All routes require the existing session cookie. The actor comes from the session, and every operation checks household membership and item ownership.

- `POST /api/households/:householdId/items`: `{ name, primaryUnit, trackingMode? }`; omitted mode means `QUANTITY`.
- `GET /api/households/:householdId/items` and `GET .../items/:itemId`: include tracking state; detail also includes ordered `stateActions` with before/after fields.
- `PUT .../items/:itemId/state/config`: `{ lowAtLevel, buyAtLevel, neverRunOut }`; Admin only, five-level only.
- `POST .../items/:itemId/state/level`: `{ level }`; five-level only.
- `POST .../items/:itemId/state/backups`: `{ count }`; positive integer added to backups for five-level or presence/backup.
- `POST .../items/:itemId/state/open-refill`: no body; opens one backup when current is empty/absent.
- `POST .../items/:itemId/state/presence`: `{ present }`; presence/backup only.
- `GET /api/households/:householdId/stock-intelligence`: includes mode-aware assessments. For nonquantity modes, quantity and expiry measures are null, `suggestion` is null, and `recommendedAction` explains what to do.

Invalid input returns 400, an unavailable or already opened refill returns 409, missing household membership returns 403, and an item outside the household returns 404.

## Deferred Phase 1 gaps

Five-level and presence/backup Shopping Trip entries and completion restock, frontend UI, opened-item expiry, Undo, notifications, and detailed shopping uncertainty checks are outside this backend slice. Quantity Shopping Trips remain supported.
