# Location-aware stock writes (proposed Phase 1 slice)

## Source and problem

The master prompt treats a location as a physical place, permits one quantity item to have batches in multiple locations, asks Add Item for a location, and says Restock should reuse a previous/default location rather than asking again when it is known (sections 9, 19, 20, and 21). The current Add Item flow locates its initial batch, but direct Restock and Shopping Trip Finish create new quantity batches with `locationId: null`. That makes location filtering and the future Check Location flow incomplete.

## Goal

Keep the location of each new quantity batch meaningful while retaining one-action Restock and Shopping. Do not derive stock placement from category, tags, or a different item. This slice does not move existing batches, change FEFO ordering, or implement Check Location yet.

## Proposed contract

- `StockBatch.locationId` remains the source of truth for where quantity stock physically is. A single item may have batches in several locations.
- Add an optional item-level `preferredRestockLocationId` as a **default for future writes**, not as the item's only stock location. Add Item sets it from its required location even when starting quantity is zero. Existing items may have no preference.
- For direct Restock (also used by Quick Purchase), accept an optional `locationId`. For Shopping, accept an optional `locationId` in the existing entry update and persist it with the entry before Finish. For each new quantity batch, resolve location in this order: that write's explicit location; the item's preferred restock location; the most recently created located batch for that same item; otherwise return a `LOCATION_REQUIRED` validation result before changing stock. Never borrow another item's location.
- Validate an explicit or preferred location against the URL household on the server. An explicit valid choice becomes that item's new preferred restock location in the same transaction as the batch and activity. A location inferred from an older batch may also initialize a missing preference. Existing batch locations are never rewritten.
- Shopping Finish must remain atomic. If one purchased quantity item has no resolvable location, the trip and all its Restock writes remain unchanged. The response identifies the item requiring a location so the client can ask only for that missing field and retry. State-mode backup purchases continue to use their existing backup-location model; no quantity batch is fabricated.
- Item read and trip-entry read responses should expose the preferred location (or an explicit `null`) so FE can show the default and request an override before committing. The server repeats all validation; FE-provided values are not trusted.

## Decisions to verify while implementing

Define the exact `LOCATION_REQUIRED` response shape in the API contract before code changes. Preserve existing items and null-location legacy batches through an additive migration; do not backfill unknown physical locations by guessing. Check Location is a subsequent, separate flow built on located stock and should not require creating a Shopping Trip.

## Definition of done for the implementation slice

Database and API tests cover zero-stock Add Item, direct Restock, Quick Purchase, Shopping Finish with multiple purchased items, explicit override, household mismatch, legacy fallback, unresolved location rollback, and unchanged FEFO/stock totals. FE integration is a separate task. Inspect any migration before applying it to the named local database.

## Implemented API contract

The slice is implemented by the API changes described below. Existing legacy batches remain nullable and untouched.

### Item default and read fields

Atomic `POST /api/households/:householdId/items` continues to require `locationId`. In addition to its existing located initial batch (when quantity is positive), the created item stores that ID as `preferredRestockLocationId`, including when quantity is exactly zero. `GET /api/households/:householdId/items`, `GET /api/households/:householdId/items/:itemId`, and the Add Item response expose `preferredRestockLocationId` and `preferredRestockLocation: { id, name } | null`. The preference is a default for later quantity writes; each batch's `locationId` remains its physical location.

### Direct Restock

`POST /api/households/:householdId/items/:itemId/restock` accepts:

```json
{ "quantity": "2", "expiryDate": "2026-11-30", "locationId": "location-id" }
```

`expiryDate` and `locationId` are optional. If the explicit location is omitted or null/empty, the API uses the item's preferred location, then the latest located batch for the same item ordered by `createdAt DESC, id DESC`. It validates the resolved location belongs to the URL household. An explicit valid location updates the item's preference in the same database transaction as the `StockBatch` and `RESTOCK` `InventoryAction`. The success response remains `{ batch, action }`; `batch` includes `locationId` and `location: { id, householdId, name, nameKey }` (or null for legacy reads), and `action` includes its allocations. No stock totals, FEFO, or expiry rules changed.

### Shopping entry location and Finish

`PATCH /api/households/:householdId/trips/:tripId/entries/:entryId` accepts a quantity purchase body such as:

```json
{
  "status": "PURCHASED",
  "actualQuantity": "3",
  "expiryDate": "2026-11-30",
  "locationId": "location-id"
}
```

The `locationId` is optional for QUANTITY items, is validated against the URL household when supplied, and is persisted on the entry. `GET /api/households/:householdId/trips/:tripId` returns `entries[].location: { id, householdId, name, nameKey } | null`, plus `entries[].item.preferredRestockLocationId` and `entries[].item.preferredRestockLocation: { id, name } | null`. Clearing an entry to PENDING or SKIPPED clears its purchase location. Nonquantity entries do not accept a location.

`POST /api/households/:householdId/trips/:tripId/finish` resolves each purchased quantity entry in this order: saved entry location, item preference, most recently created located batch for that same item. An explicit selection becomes the item's preference; a history fallback initializes an absent preference. State-mode backup purchases keep using the existing backup-location/state mutation path and do not create quantity batches.

If no location can be resolved, Finish returns HTTP 400:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "LOCATION_REQUIRED",
  "message": "Choose a location before recording this stock.",
  "itemId": "inventory-item-id"
}
```

No batch, action, item preference, pending-entry update, or trip status change commits. Finish's existing transaction rolls back earlier entry writes if a later entry needs a location. An invalid/cross-household location returns HTTP 400 with `code: "LOCATION_NOT_FOUND"` and the same `itemId`; a non-string `locationId` returns `INVALID_LOCATION_ID`. A non-empty location on a nonquantity purchase returns `LOCATION_NOT_SUPPORTED`. The location errors include `statusCode`, `error`, `code`, `message`, and `itemId`. The API does not disclose a foreign household's location.

## Migration and verification status

Create-only migration `apps/api/prisma/migrations/20261013160020_location_aware_stock_writes/migration.sql` adds nullable `InventoryItem.preferredRestockLocationId` and `ShoppingEntry.locationId`, with foreign keys to `Location`. It has no backfill and has not been applied. The configured local `127.0.0.1:55432/lumio_local` database reported 11 existing migrations applied before generation; tests requiring the new columns must wait for review/application. Focused service tests cover explicit override, preferred default on a zero-stock item, household validation, same-item legacy batch fallback, `LOCATION_REQUIRED`, and atomic trip rollback.

## FE integration still needed

- Send optional `locationId` on direct Restock and quantity Shopping entry purchase updates.
- Display the returned item preference and trip entry location; allow the user to choose a household location when `LOCATION_REQUIRED` includes `itemId`, then retry the failed user action explicitly.
- Handle `LOCATION_NOT_FOUND` and `INVALID_LOCATION_ID` as contract errors. Existing items without a preference and without a located legacy batch will need a location choice on first Restock/Finish.
- Do not treat the preferred location as the location of every existing batch, and do not offer location controls for nonquantity purchase entries.
