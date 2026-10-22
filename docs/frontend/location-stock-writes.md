# Location-aware stock writes

The active Item Detail, Quick Purchase, and Shopping Trip Quantity purchase forms use the household locations endpoint (`GET /api/households/:householdId/locations`). A location selector defaults to the item's `preferredRestockLocation` when the API returns one. Users can choose another household location; Quantity Restock sends `locationId`, Quick Purchase sends it with the Restock request, and Shopping saves it on the trip entry before Finish.

The preferred location is a default for future stock writes. It does not describe the physical location of every existing batch. Batch placement continues to come from Item Detail batch `location` data returned by the API.

When a mutation returns `LOCATION_REQUIRED`, the shared API error retains the response `code` and `itemId`. The UI asks for a location for that item and exposes an explicit retry control. Shopping first saves the selected entry location, then retries Finish only after the user confirms. `LOCATION_NOT_FOUND` and `INVALID_LOCATION_ID` show the API's returned message. No stock calculation or placement fallback is implemented in the frontend.

Location input is limited to Quantity Restock, existing-item Quantity Quick Purchase, and Quantity Shopping entries. Add Item continues to use its required atomic `locationId`; nonquantity purchase flows do not send a stock batch location.

## Check Location

Inventory links to `/households/:householdId/locations/:locationId/check`. This checklist is independent of a Shopping Trip. It displays the server's complete ordered `items[]`, location-scoped `stock`, `status`, `reason`, `stockRevision`, and saved check time/actor presence. Confirm and Correct send the latest response's `stockRevision` as `expectedRevision` to the location-scoped PUT endpoint.

Quantity correction uses the selected-location total. If the API returns `BATCH_DETAIL_REQUIRED`, the page refetches the API-provided batch list and reveals per-batch observation inputs, additional unopened quantity, and optional expiry. State-mode inputs appear only for fields present in that item's selected-location `stock` object. A `STOCK_CHANGED` response triggers a refetch and asks the user to review the latest values; the client never retries automatically.

After a saved check, the page refreshes household-scoped queries so Inventory, Item Detail, Home, stock intelligence, Shopping stock checks, and this location checklist see API results. The server remains responsible for validation, totals, revision changes, and batch writes.

## Historical local browser verification — 2026-10-14

The notes below describe a past disposable local fixture, not the current database or deployment. Use the active API contracts and fresh environment-specific checks for current status.

The local database was `127.0.0.1:55432/lumio_local`; Prisma reported all 14 migrations up to date. Initially, the API process was serving an older build and returned 404 for Check Location. After restarting that local process from the existing `apps/api/dist` (no source build or migration change), an unauthenticated request reached the session guard (401), and the signed-in browser could use the route. Browser mutations used the disposable `STOCK CHECK FOLLOWUP 2026-10-13` household (`6ca6979e-cf9e-41d4-b835-e2e3f78c9717`), not Lumio Demo.

Observed through the UI, which renders API responses and refetched API data:

- Quantity Restock on `Smoke Move Quantity 2026-10-14` with Smoke pantry selected saved successfully. Item Detail showed total 5; Inventory showed 4 at Smoke pantry and 1 at Smoke shelf B. The location preference updated to Smoke pantry. A later smoke pass had already shown the explicit shelf-B override creating a located batch while leaving 2 units at the pantry.
- Existing-item Quick Purchase for the same Quantity item, amount 1, with Smoke shelf B selected showed “Purchase saved” and made that location the preference. Raw request JSON and HTTP response bodies were not captured in DevTools, so only UI/API-backed readback is recorded here.
- Quantity Shopping purchase was saved with Smoke shelf B selected and the source trip finished. The source UI showed “Bought 1 can”; Item Detail for `Conflict probe` refetched physical total 2, one opened plus one unopened, and a new unopened 1-can batch at Smoke shelf B. Its Activity showed the restock at 14:50:09 on 2026-10-14. This is UI/API-backed readback, not a separately captured raw Finish response.
- A zero-stock, unlocated disposable Quantity item was Restocked with quantity 1 and no location. The page displayed the API error “Choose a location before recording this stock” and offered an explicit retry. After selecting Smoke pantry and clicking “Confirm location and retry Restock,” Item Detail showed total 1 and Smoke pantry as the preference. The HTTP status/body were not captured separately.
- Check Location initially saved Confirm and Quantity Correct at Smoke pantry, increasing the selected-location total from 2 to 3 while the other location stayed at 1. A FIVE_LEVEL Correct changed backups from 2 to 3 while retaining level `half`. After navigating away and reopening the route, the saved CORRECT states and values remained visible.
- After another quantity Restock of 1 at Smoke pantry, the location checklist displayed `STALE` with “Stock changed since the last check”; Item Detail total was 5, and Inventory showed pantry 4 and shelf B 1. The state item remained CORRECT at `half` with 3 backups.
- `BATCH_DETAIL_REQUIRED` and `STOCK_CHANGED` conflict branches were not retriggered in this pass. Prior smoke notes record the general stock-check conflict flow; raw HTTP revision/body evidence was not captured in this pass.

Still unverified in browser: a Check Location Confirm for a state-mode item; PRESENCE_BACKUP correction; Quick Purchase Item Detail batch readback; Shopping Finish `LOCATION_REQUIRED` recovery; and exact raw HTTP request/response body capture for any of these UI requests. The Restock `LOCATION_REQUIRED` retry branch and chosen-location Shopping Finish were exercised above.
