# Opened quantity stock backend contract

This opt-in Phase 1 slice applies only to `QUANTITY` items counted as packages: one box, bottle, or similar container equals one primary unit. The API does not convert grams or milliliters into package sizes. Existing items default to `openedTrackingEnabled: false` and retain the earlier Use and Restock behavior.

All routes below use `/api/households/:householdId/items/:itemId`, the session actor, and household-scoped item checks. Only an Admin changes the opening setting; members may perform stock actions.

| Operation | Request | Result |
| --- | --- | --- |
| `PUT /opening-config` | `{ enabled: boolean, recommendedDaysAfterOpening: positive integer or null, packageCountConfirmed: true }` when enabling | Sets opening policy. Existing positive unopened batch quantities must be whole units. Disable is rejected while positive opened stock remains. |
| `POST /open` | No body | Moves one eligible whole unit from the earliest-expiring unopened batch into a new opened batch at the same location. Returns `{ batch, action }`. Item total is unchanged. |
| `POST /use` | Existing `{ quantity: positive decimal string }` | For enabled items, uses eligible opened stock first. If short, opens enough whole unopened containers by unopened FEFO, then completes Use atomically from opened stock by effective-expiry FEFO. On insufficient eligible stock, the entire operation rolls back. Disabled items retain their existing FEFO path. |
| `POST /finish-opened` | No body | Consumes the positive remainder of the earliest-expiring eligible opened batch. Creates one `FINISH_OPENED` action and allocation; this quantity contributes to the 14-day consumption rate. |
| `POST /api/households/:householdId/items/:itemId/restock` | `{ quantity, expiryDate?, locationId? }` | Create an unopened batch at the resolved physical location. For enabled items, restocked quantities must be whole container counts. Location resolves explicit ID, item preferred location, then this item's latest located batch; otherwise the API returns `LOCATION_REQUIRED`. |
| Shopping Trip Finish | Quantity entry's saved `locationId?` | Create unopened batches at resolved locations. For enabled items, purchased quantities must be whole container counts. See [Shopping Trip API contract](SHOPPING_CONTRACT.md) for entry updates and error responses. |

The server chooses batches. It never automatically consumes an expired batch. Opened stock is used before unopened stock, even when an unopened batch has an earlier original expiry. Within each group, the earlier effective expiry wins; undated batches follow dated batches. An automatic Open creates its own attributed `OPEN` action and `OpenTransfer` source/target trace. It does not create a Use/Restock allocation. A separate `USE` action still records its exact consumed quantity and allocations. `FINISH_OPENED` acts as consumption and is included with `USE` in prediction history.

`StockBatch.expiryDate` remains the original expiry. `openedAt` marks an opened batch; `openedUseByDate` snapshots the item rule at opening. Effective expiry is the earlier of original expiry and opened use-by date, or the available date when only one exists. The opening deadline is opening date in `Asia/Ho_Chi_Minh` plus `recommendedDaysAfterOpening` calendar days. Eligibility includes the effective expiry date and ends the next local day. Use Soon uses the existing three-day window and effective expiry. Restock never sets opening fields.

`GET /items/:itemId` returns item settings, `openedQuantity` and `unopenedQuantity` decimal strings, batches with original `expiryDate`, `openedAt`, `openedUseByDate`, and `effectiveExpiryDate`, plus actions and their Open transfer links. The plain and filtered inventory list expose those batch fields and totals as well. Stock-intelligence assessments expose opened/unopened quantities and calculate eligible, expired, and Use Soon stock from effective expiry. `status=OPENED` filters items with positive opened quantity.

This slice defers Undo, Discard, freeze dates, package-size conversion, and manual batch override. A Use that would automatically open more than 1,000 containers is rejected as a transaction-size safety limit.
