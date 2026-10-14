# Atomic Add Item backend contract

This contract is implemented in `POST /api/households/:householdId/items`. The actor is derived from the server-managed session. A household member may add an item; household Admins create catalog options.

```json
{
  "name": "Milk",
  "primaryUnit": "box",
  "trackingMode": "QUANTITY",
  "categoryId": "household-category-id",
  "locationId": "household-location-id",
  "tagIds": ["household-tag-id"],
  "initialStock": { "quantity": "6", "expiryDate": "2026-10-20" }
}
```

`trackingMode` also accepts `FIVE_LEVEL` with `initialStock: { "level": "QUARTER", "backupCount": 2 }`, or `PRESENCE_BACKUP` with `initialStock: { "present": true, "backupCount": 1 }`. The level values are exactly `FULL`, `THREE_QUARTERS`, `HALF`, `QUARTER`, and `EMPTY`. Backup count defaults to zero and must be a non-negative 32-bit integer. Tags are optional. For the new contract, category, location, and initial stock are required and all IDs must belong to the URL household. Quantity is a decimal string in the item's primary unit, with at most six fractional digits and Decimal(18,6) bounds. Exact `"0"` is accepted; it creates no batch or stock-change activity and cannot have an expiry date.

The response is the created item with category, tags, current/backup locations, `preferredRestockLocationId` and `preferredRestockLocation`, batches with batch locations, quantity actions and allocations, and state actions. The required Add Item `locationId` initializes the item's preferred restock location for every tracking mode, including a zero-stock quantity item. A positive initial quantity creates one located batch and one attributable `INITIAL_STOCK` action with a positive allocation. Five-level and presence creation sets both current and backup location IDs to the supplied location and records one attributable `INITIALIZE` state action. These writes share one transaction with item creation. Any failure rolls back the entire Add Item operation.

`GET` and `POST /api/households/:householdId/categories`, `/locations`, and `/tags` provide list and Admin-only create for the Add Item selectors. Names are normalized for duplicate checking within each household. Item detail and list include classification and placements; search and grouping are outside this backend slice.

The old `{ name, primaryUnit, trackingMode? }` request remains a **transitional empty-item path** for existing clients; it does not complete the Phase 1 Add Item UX. It has no preferred restock location. Direct Restock and Shopping Finish resolve a new quantity batch's location from the request/entry, then this item preference, then this same item's latest located batch. They return `LOCATION_REQUIRED` if none exists. The API never infers a physical location from another item. Existing batches with null `locationId` remain unknown; no migration backfill guesses their placement. Existing rows retain nullable category and location references until explicitly classified. For non-quantity items, the current/home location and aggregate backup location are distinct fields; initial Add Item sets both to the selected location.

The reviewed `20261010091418_atomic_add_item_catalog` migration was applied and tested on local `127.0.0.1:55432/lumio_local` only. This does not establish the migration state of any other database.
