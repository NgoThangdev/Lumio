# Phase 1 inventory Undo backend contract

This slice covers a successful `USE` on a `QUANTITY` item with opened tracking off, `FINISH_OPENED`, `UPDATE_LEVEL`, and `SET_PRESENCE`. The original actor may Undo for two minutes measured by server time. The API checks eligibility; clients must use `undoEligibility`, not infer support from the action type or a local timer. Existing historical actions without `postStockRevision` (and, for quantity actions, allocation `quantityAfter`) are ineligible.

Eligible quick-action responses retain their existing fields and add `undoEligibility: { eligible: true, expiresAt: ISO timestamp }`. An opened-tracking `USE` and unsupported state transitions return `{ eligible: false, expiresAt: null, reason: "UNDO_UNSUPPORTED" }`. `USE` actions that automatically Open are not Undo-eligible. `GET /api/households/:householdId/items/:itemId` retains original actions and state actions, each with an `undo` relation, and includes chronological `undos` reversal records. Original actions are never deleted or rewritten.

`POST /api/households/:householdId/items/:itemId/undo` accepts `{ "actionKind": "INVENTORY" | "STATE", "actionId": "uuid" }` and returns:

```json
{
  "undoId": "uuid",
  "originalActionId": "uuid",
  "actionKind": "INVENTORY",
  "undoneAt": "2026-10-13T09:00:00.000Z",
  "stockRevision": 4,
  "alreadyUndone": false
}
```

A repeated request from the original actor returns the same stored Undo identifiers, time, and revision with `alreadyUndone: true`, even after the window or another stock change. A successful first Undo restores exact recorded `USE` or `FINISH_OPENED` batch quantities without rerunning FEFO, or restores the prior level/presence state. The item revision increments once. `USE` and `FINISH_OPENED` originals linked to an Undo are excluded from both the 14-day consumption total and distinct-use-day confidence check. Fresh intelligence and recommendations recalculate; existing imported Shopping Trip suggestions remain snapshots. Earlier pre-shopping confirmations become stale due to the revision increment.

The server verifies household membership, item ownership, original actor, action provenance, compatible tracking configuration, two-minute window, unchanged item revision, and matching batch quantities or state under the item row lock. The inverse and attributable Undo record commit in one transaction. Errors are `400 INVALID_UNDO_REQUEST`, `403 HOUSEHOLD_MEMBERSHIP_REQUIRED` or `UNDO_ACTOR_REQUIRED`, `404 ITEM_NOT_FOUND` or `ACTION_NOT_FOUND`, and `409 UNDO_UNSUPPORTED`, `UNDO_WINDOW_EXPIRED`, `UNDO_STOCK_CHANGED`, or `UNDO_TARGET_CHANGED`. Any rejection leaves stock and activity unchanged.

Undo of standalone `OPEN`, opened-tracking `USE`, direct or Shopping Trip `RESTOCK`, `INITIAL_STOCK`, `ADD_BACKUP`, `OPEN_REFILL`, and stock-check corrections is deferred. Current `RESTOCK` and `ADD_BACKUP` records lack direct-versus-trip provenance; automatic `OPEN` and `USE` records lack an operation-group link. Undoing those actions individually would risk inconsistent physical stock or trip history.
