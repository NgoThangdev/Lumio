# Household Catalog API

Routes are under `/api/households/:householdId`. A validated session is required (`401` without one). Household members may read `GET /categories`, `/locations`, and `/tags`. Only a household Admin may create, rename, change a category's shopping section, or remove a catalog record (`403` otherwise). A missing ID or one from another household returns `404 CATEGORY_NOT_FOUND`, `LOCATION_NOT_FOUND`, or `TAG_NOT_FOUND`.

## Rename

`PATCH /categories/:categoryId`, `/locations/:locationId`, or `/tags/:tagId` accepts exactly `{ "name": "New name" }` and returns `200` with `{ id, name, shoppingSection }` for a Category or `{ id, name }` for a Location or Tag. Name uses the existing Unicode NFKC normalization, whitespace trimming/collapse, 1-80 character limit, and household-scoped normalized uniqueness. Invalid names or fields return `400 INVALID_CATALOG_NAME` (or the existing name-validation message). A normalized name collision returns `409 CATALOG_NAME_EXISTS`. Repeating the saved display name is a no-op.

Category `PATCH` also continues to accept exactly `{ "shoppingSection": <approved-code-or-null> }`, with its existing `400 INVALID_SHOPPING_SECTION` validation. A request may change **one** field only. Renaming a Category leaves its section mapping unchanged; changing the section leaves its name unchanged.

## Category Inventory Defaults

Category list, create, rename, shopping-section update, and inventory-default responses expose `defaultTrackingMode` and `defaultPrimaryUnit` (both `null` when unset). Household members may read them. Only an Admin may update them.

`PATCH /categories/:categoryId/inventory-defaults` accepts a non-empty partial object containing either or both fields. Omitted fields remain unchanged; explicit `null` clears that field. For example, `{ "defaultTrackingMode": "FIVE_LEVEL" }` is a valid mode-only hint and `{ "defaultPrimaryUnit": "box" }` is a valid unit-only hint. The tracking mode must be `QUANTITY`, `FIVE_LEVEL`, `PRESENCE_BACKUP`, or `null`. The unit must be a non-empty trimmed string of at most 40 characters or `null`; the server trims surrounding whitespace. Success returns `200` with `{ id, name, shoppingSection, defaultTrackingMode, defaultPrimaryUnit }`.

An empty body, unknown fields, or a non-object body returns `400 INVALID_INVENTORY_DEFAULTS`; an unsupported mode returns `400 INVALID_DEFAULT_TRACKING_MODE`; an invalid unit returns `400 INVALID_DEFAULT_PRIMARY_UNIT`. A non-Admin or non-member receives `403`; a missing category or a category outside the URL household returns `404 CATEGORY_NOT_FOUND`. These hints are shown to Add Item clients as prefill suggestions only. `POST /items` continues to use its explicit Add Item request contract and never resolves missing mode or unit from Category defaults. Updating defaults changes only the Category row; existing and archived items, stock, revisions, rules, suggestions, and history are untouched.

## Safe removal

`DELETE /categories/:categoryId` and `DELETE /locations/:locationId` return `204` with no body only when no references remain. There is no Tag DELETE in Phase 1. Removal never clears or reassigns an item, batch, tag, check, or Shopping entry, and does not rewrite a trip. The server locks the catalog row, checks references, and deletes in one transaction. Concurrent foreign-key conflicts return the same controlled `409` response.

When blocked, Category deletion returns `409 { "code": "CATEGORY_IN_USE", "references": { "activeItems": 0, "archivedItems": 0, "itemChanges": 0 } }`. It counts active and archived item assignments plus item-change before/after JSON references. Location deletion returns `409 { "code": "LOCATION_IN_USE", "references": { "currentItems": 0, "backupItems": 0, "preferredItems": 0, "batches": 0, "shoppingEntries": 0, "stockChecks": 0, "itemChanges": 0 } }`. Counts include archived item placements, zero-quantity historical batches, completed-trip entries, location stock-check records, and item-change before/after JSON references. Item metadata Edit returns `409 CATALOG_REFERENCE_CHANGED` if a concurrent catalog deletion invalidates its new reference; it writes no item change in that case. A record may remain non-removable indefinitely; catalog retirement is deferred.

Catalog names are live labels on item and trip reads. Rename changes displayed labels but not Category section mapping, physical stock placement, saved suggestion amounts/reasons, purchased amounts, or trip status. There is no schema migration for this slice.
