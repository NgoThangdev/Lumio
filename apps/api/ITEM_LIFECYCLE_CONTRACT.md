# Inventory Item metadata and lifecycle API

All routes require a valid session. They are scoped to `/api/households/:householdId/items`; Admin operations require Admin membership in that household. Missing session is `401`, missing Admin membership `403 HOUSEHOLD_ADMIN_REQUIRED`, and a missing or foreign-household item `404 ITEM_NOT_FOUND`.

## Metadata Edit

`PATCH /:itemId` accepts a nonempty subset of `{ "name": "Fresh Milk", "categoryId": "<id>" | null, "tagIds": ["<id>"], "preferredRestockLocationId": "<id>" | null }`. Omitted fields stay unchanged. `null` clears category or preferred restock location; `[]` clears tags. Name is trimmed, nonempty, at most 120 characters. Every category, tag, and location must belong to the URL household. Success returns `200` with the updated item detail. A no-op edit returns the item without a change record. Invalid/unknown fields return `400 INVALID_ITEM_METADATA`, invalid name `INVALID_ITEM_NAME`, malformed references `INVALID_ITEM_REFERENCE` or `INVALID_TAG_IDS`, and foreign/missing references `CATEGORY_NOT_IN_HOUSEHOLD`, `LOCATION_NOT_IN_HOUSEHOLD`, or `TAG_NOT_IN_HOUSEHOLD`. Archived items return `409 ITEM_ARCHIVED`.

Generic Edit cannot change stock quantity, batches, expiry, physical stock locations, tracking mode, primary unit, or stock-rule configuration. It does not increment `stockRevision`. A meaningful edit atomically appends an item change with actor, timestamp, and before/after metadata. Stock actions and rule configuration retain their separate endpoints.

## Archive and Restore

`POST /:itemId/archive` and `POST /:itemId/restore` are Admin-only and return `201` with the updated item detail. Archive keeps the item, positive stock, batches, actions, Undo, shopping history, and stock-check history. It appends an attributable `ARCHIVE` change; Restore appends `RESTORE`. Repeating either command when already in that state returns the current detail without another change. Neither command increments `stockRevision` or changes trip entries. Archived item detail includes `archivedAt` and `changes: [{ id, householdId, itemId, actorId, kind, before, after, createdAt }]` and is readable by an Admin; a Member's direct archived detail read returns `403`.

Archive checks all `DRAFT` and `SHOPPING` trip entries, including Purchased, Skipped, and Moved decisions. If any exists, it returns `409 { "code": "ACTIVE_TRIP_ENTRY", "tripIds": ["<blocking-trip-id>"] }` with distinct sorted IDs and makes no change. A household member can remove an entry explicitly through the Shopping entry-removal endpoint. Finished trips stay immutable.

`GET /archived` is Admin-only and returns `200 [{ id, name, primaryUnit, archivedAt }]`, newest archive first. Normal Inventory lists and filters, Home attention, stock intelligence, stock-check shortlists, manual Shopping additions, and new suggestions omit archived items. Ordinary stock mutations on an archived item return `409 ITEM_ARCHIVED` after household authorization. Existing saved trip suggestion snapshots and historical activity remain readable; Restore re-includes retained stock in fresh assessments. Archive and Shopping creation/import lock item rows so a concurrent request cannot leave a new active entry for an archived item.
