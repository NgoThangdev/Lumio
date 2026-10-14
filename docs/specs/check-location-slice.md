# Check Location — proposed Phase 1 slice

## Source and goal

The master prompt section 19 and Phase 1 scope require a fast physical stock check by location, with uncertain items first. The flow is `Inventory → Location → Check stock`; it must not require a Shopping Trip. The location-aware stock-write slice supplies physical batch placement, but does not yet provide this check flow.

## Domain boundary

- A quantity item's stock at a selected location is the sum of its batches **at that location**, not its household-wide total. Include opened and unopened batch detail when relevant. A batch at another location must never be changed by this check.
- A five-level or presence item may have its current item and aggregate backups at different locations. Show and permit correction only for the part configured at the selected location. Do not imply that a backup at another location is physically present here.
- A check is an observation, not consumption. Confirmation does not change stock. A correction changes stock/state, increments the item's stock revision, and records actor, time, and before/after values atomically. Check corrections do not count as `USE` in the 14-day consumption average.
- A location check is independent of `TripStockCheck`. The pre-shopping shortlist and its trip-specific snapshot remain unchanged.

## Proposed API contract

`GET /api/households/:householdId/locations/:locationId/stock-check` returns the selected location and all items associated with it, not merely a top-five shortlist. Association includes positive or retained zero-quantity batches at the location, an item whose preferred restock location is selected even if it currently has no batch, or a non-quantity item's current or backup placement there. Return an item-level `stockRevision`, location-scoped stock snapshot, last check actor/time, and a status/reason suitable for a checklist. Put uncertain or stale items first, with stable name/ID order for ties. The exact uncertainty age is a technical default; the existing pre-shopping 30-day convention is a reasonable starting point, not a master-prompt number.

`PUT /api/households/:householdId/locations/:locationId/stock-check/:itemId` accepts `expectedRevision` and `decision: CONFIRM | CORRECT`. A confirm saves a check record without changing stock. A correction supplies only the observed fields that physically belong to the chosen location: quantity (and batch counts when required) for quantity mode; current level/presence and/or backup count only when those placements match the location. Return the refreshed location checklist item and whether stock changed.

The backend checks authentication, household membership, location ownership, item association, and `expectedRevision`. A concurrent stock change returns `409 STOCK_CHANGED` and no partial correction. Repeated confirmation by the same actor at the current revision should be idempotent. Saving the check record and any stock correction must be one transaction under the item lock. The server owns batch totals and state transitions; FE does not recalculate them.

## Correction safety

- For quantity items, correct only batches assigned to this location. If batches have distinct expiry/opened properties, require explicit per-batch observed counts (`BATCH_DETAIL_REQUIRED`) instead of guessing which batch changed. Any newly observed stock is a new batch at this location; expiry remains optional unless a separate item rule requires it. Preserve the existing six-decimal and whole-package validation.
- If a user finds stock in a **different** location, do not silently move a batch during a count correction. Relocation is a separate action/decision. A zero observation here must not decrement stock elsewhere.
- For state modes, never update a current level or presence from a check at a backup-only location, or update backups from a current-only location.
- Retain checks for resume and audit. A later item stock revision makes an earlier check visibly stale; do not silently mark it confirmed again.

## Implementation boundaries and evidence

Backend first: additive check-history storage, location-scoped read/mutation endpoints, contract documentation, and focused tests. No `apps/web` edits in the backend task. Review a create-only migration before applying it. Tests must cover multi-location isolation, same-location batch details, state-mode split placements, membership/household isolation, stale revision, transactional rollback, idempotent confirm, and no effect on 14-day consumption. FE integration and browser smoke are a separate handoff.
