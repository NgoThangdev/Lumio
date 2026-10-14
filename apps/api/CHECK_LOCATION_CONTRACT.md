# Phase 1 Check Location backend contract

This flow is independent of a Shopping Trip and its `TripStockCheck` snapshot. `StockBatch.locationId` identifies physical quantity stock. For state items, `currentLocationId` and `backupLocationId` identify separately placed current and backup stock. The server validates every write and computes every returned total.

## Read

`GET /api/households/:householdId/locations/:locationId/stock-check` requires an authenticated household member. It returns all associated items: quantity items with any batch (including retained zero batches) at the selected location or that preferred restock location, and state items whose current or backup placement is there. The response is:

```json
{
  "location": { "id": "location-id", "name": "Fridge" },
  "items": [
    {
      "itemId": "item-id", "name": "Milk", "trackingMode": "QUANTITY",
      "openedTrackingEnabled": false, "stockRevision": 3,
      "stock": {
        "quantity": "2",
        "batches": [{ "id": "batch-id", "quantity": "2", "expiryDate": "2026-11-30", "openedAt": null, "openedUseByDate": null }]
      },
      "status": "PENDING", "reason": "STALE_RECORD",
      "checkedAt": null, "checkedByUserId": null
    }
  ]
}
```

For FIVE_LEVEL, `stock` contains `currentLevel` only when the current placement is here and `backupCount` only when backups are here. For PRESENCE_BACKUP, it similarly contains `isPresent` and/or `backupCount`. Absent fields mean that part is at another location. Quantity totals and batch detail include only batches at this location; a preferred location with no batches returns `quantity: "0"` and `batches: []`.

`status` is `PENDING`, `CONFIRM`, `CORRECT`, or `STALE`. A saved check is `STALE` when its revision differs from the current item revision, with reason `STOCK_CHANGED`. Otherwise reason is `MISSING_STATE`, `NO_STOCK_RECORD`, `STALE_RECORD`, or `RECENT_RECORD`. The initial technical uncertainty age is 30 days from the newest relevant local stock evidence or check. Uncertain and stale items sort first, then name and ID. Low stock by itself does not imply uncertain stock. The checklist is recomputed on each GET; saved checks retain actor, time, stock snapshots, revision, and per-save history for resume and audit.

## Confirm or correct

`PUT /api/households/:householdId/locations/:locationId/stock-check/:itemId` accepts `{ "decision": "CONFIRM", "expectedRevision": 3 }`. Confirm records the observation without changing stock or incrementing the item revision. The same actor repeating an identical Confirm at the current revision receives the saved result without another history entry. A different actor's Confirm records that actor's observation.

`CORRECT` requires an observation for the selected location only:

```json
{ "decision": "CORRECT", "expectedRevision": 3, "quantity": "1.5" }
```

For a quantity item, `quantity` is a nonnegative decimal string with at most six fractional places. If positive batches at this location have distinct expiry/opened properties, send exact counts for every positive batch:

```json
{
  "decision": "CORRECT", "expectedRevision": 3, "quantity": "3",
  "batches": [{ "batchId": "batch-id", "quantity": "2" }],
  "extraUnopenedQuantity": "1", "extraExpiryDate": "2026-11-30"
}
```

`batches` must name every currently positive batch at this location exactly once. The sum of observed batch quantities and `extraUnopenedQuantity` must equal `quantity`. Existing unopened batches cannot be increased; newly observed stock becomes a new unopened batch at this location, with optional `extraExpiryDate`. Opened tracking retains whole unopened packages and opened batch quantities no greater than one. A simple total correction without batch detail can reduce homogeneous existing batches or add a new unopened batch. It never edits a batch in another location.

For state items, send one or more fields present in the selected location's `stock`: `{ "currentLevel": "HALF" }`, `{ "isPresent": false }`, or `{ "backupCount": 2 }`. The server rejects fields assigned to a different location. A correction that changes stock increments `stockRevision` once; a same-value correction records the observation without a revision change.

Success returns `{ "item": <refreshed checklist item>, "changed": true | false }`. The correction and attributed before/after history record commit atomically under the item row lock. Corrections do not create `USE` actions and do not enter the 14-day consumption rate. A later item mutation makes this check stale; it does not rewrite imported Shopping Trip suggestions.

Errors use Nest's `{ "statusCode", "message", "error" }` shape. Relevant reasons are `400 INVALID_EXPECTED_REVISION`, `INVALID_CHECK_DECISION`, `INVALID_QUANTITY`, `INVALID_BATCH_COUNTS`, `INVALID_BATCH_COUNT`, `BATCH_TOTAL_MISMATCH`, `INVALID_EXTRA_QUANTITY`, `INVALID_EXPIRY_DATE`, `INVALID_PACKAGE_COUNT`, `INVALID_LEVEL`, `INVALID_PRESENCE`, `INVALID_BACKUP_COUNT`, `FIELD_NOT_AT_LOCATION`, or `OBSERVATION_REQUIRED`; `403 HOUSEHOLD_MEMBERSHIP_REQUIRED`; `404 LOCATION_NOT_FOUND`, `ITEM_NOT_FOUND`, or `CHECK_ITEM_NOT_FOUND`; and `409 STOCK_CHANGED` or `BATCH_DETAIL_REQUIRED`. A failed request commits no stock or check history.

The additive `check_location_stock` migration must be reviewed and applied before these endpoints are used against the local database. FE integration and browser smoke remain separate.
