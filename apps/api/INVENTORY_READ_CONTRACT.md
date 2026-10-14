# Inventory read and Home Needs Attention contract

All routes require the existing session cookie and scope data to the URL household. The server supplies stock status and reasons from the existing stock-intelligence assessment; the web app should display them rather than recalculate them.

## Inventory

`GET /api/households/:householdId/items` **without query parameters** retains its existing array response. Item objects expose `preferredRestockLocationId` and `preferredRestockLocation: { id, name } | null`; these describe the default for future stock writes, not the placement of existing batches. Supplying any supported query parameter opts into `{ items, groups? }`. Each `items[]` entry contains `{ item, assessment }`, with one household-wide assessment per item. Parameters are independent and combined with AND:

| Parameter | Meaning |
|---|---|
| `q` | Case-insensitive substring of item name. |
| `categoryId` | Item's primary category. |
| `tagId` | Item has this tag. |
| `locationId` | Positive quantity batch at this location, or a non-quantity item's configured current/home or aggregate backup location. Unknown-location quantity batches do not match a named location. |
| `status` | `ALL` (default), `LOW` (includes `LOW`, `BUY`, and `OUT`), exact `BUY`, `OUT`, or `OK`, or `EXPIRING` (existing `USE_SOON` expiry risk). |
| `status=OPENED` | Quantity items with a positive opened batch balance. |
| `groupBy` | `none` (default), `category`, or `location`. |

`groups[]` is present for grouping and contains `{ id, name, entries }`. Category entries identify each item once. Location entries contain item identity, server status, and **stock at that location**: quantity items have a decimal-string `quantity` summing only positive batches there, including expired physical stock; non-quantity items have `quantity: null` and current level/presence and backup count only at their respective configured locations. A quantity item may occur in several location groups; a `locationId` filter limits location groups to that location. Empty quantity items and unknown-location batches appear under `Unlocated` when no location filter is set. Group entries do not repeat the item's household-wide total; the separate `items[].assessment` has that total. IDs within the URL household are the only data returned. Groups sort by name, with `Unlocated` last; entries follow item name then ID order.

Opened/unopened quantities and effective batch expiry follow the [opened quantity contract](OPENED_QUANTITY_CONTRACT.md). Expiry-range, shopping-status, and physical stock-check filters remain unavailable. Unsupported filters return 400 instead of silently yielding misleading results. This endpoint does not add predictions or purchase suggestions.

## Home

`GET /api/households/:householdId/home/needs-attention` returns `{ items: [...] }`, at most four items. An empty list means the section can be hidden. Each entry supplies `itemId`, `name`, `trackingMode`, existing `lowStockRisk` and `expiryRisk`, server-owned `priority` (`CRITICAL`, `HIGH`, `MEDIUM`), `action` (`BUY`, `USE_SOON`, `OPEN_REFILL`, `VIEW_ITEM`), a primary `reason`, and all relevant `reasons`.

Ordering is a technical presentation rule: out-of-stock or existing Must Buy risk first; then Use Soon; then other Buy risk; then Open refill; then Low. Ties use item name and ID. Expiry alone selects `USE_SOON` and never creates Buy risk. When an item has both expiry and independently calculated critical Buy risk, Buy leads and the expiry explanation remains in `reasons`. `OPEN_REFILL` refers to the existing state action; other action values are navigation intents, not mutations. Home reuses the existing default stock-intelligence shopping horizon and does not create shopping entries.
