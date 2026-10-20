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

## Live explanation descriptors

`GET /api/households/:householdId/stock-intelligence` returns live `assessments[]` and copies of those assessments in `useSoon[]` and `suggestions[]`. A queried `GET /items` returns the same assessment shape in `items[].assessment`. Each assessment now adds:

- `reasonExplanations: Explanation[]`, in the same order and with the same length as the existing English `reasons[]`.
- `expiryExplanation: Explanation | null`, paired with `expiryReason` (`null` when there is no current Use Soon risk).
- `prediction.explanation: Explanation`, paired with `prediction.reason`.
- `suggestion.explanation: Explanation` when `suggestion` is present. It describes the Buy action and target. Render `reasonExplanations` separately for its supporting stock conditions; the legacy `suggestion.reason` includes those English conditions in one string.

An `Explanation` is `{ "code": string, "params"?: Record<string, string | number | boolean | null> }`. Codes are stable semantic keys for FE's vi/en resources. Decimal quantities and thresholds are unformatted strings; dates are `YYYY-MM-DD` in Asia/Ho_Chi_Minh; `unit` is the item's raw primary unit. FE formats numbers, dates, plurals, and level names for the selected language. FE uses the server's risk, prediction basis, action, priority, and selected descriptors rather than deriving them from raw stock.

| Code | Params | Meaning |
|---|---|---|
| `QUANTITY_NO_ELIGIBLE_STOCK` | — | No usable quantity remains. |
| `QUANTITY_AT_OR_BELOW_MINIMUM` | `minimumStock` decimal string, `unit` | Eligible quantity reached the configured minimum. |
| `QUANTITY_AT_OR_BELOW_BUY_THRESHOLD` | `buyThreshold` decimal string, `unit` | Eligible quantity reached the Buy threshold. |
| `QUANTITY_PROJECTED_NEED` | `shoppingDate` date, `projectedNeed` decimal string, `unit`, `bufferPercent: 20` | Forecast shortage through the selected shopping date. |
| `QUANTITY_AT_OR_BELOW_LOW_THRESHOLD` | `lowStockThreshold` decimal string, `unit` | Eligible quantity reached the Low threshold without a Buy trigger. |
| `QUANTITY_ABOVE_RISK_LEVELS` | — | No configured quantity risk is active. |
| `QUANTITY_TARGET_REQUIRED` | — | A Buy risk exists but no target permits a purchase amount. |
| `QUANTITY_USE_SOON` | `quantity` decimal string, `unit`, `throughDate` date | Eligible quantity with effective expiry within the current Use Soon window. |
| `PREDICTION_DISABLED` | — | Prediction is off; thresholds apply. |
| `PREDICTION_USE_14_DAY` | `windowDays: 14`, `bufferPercent: 20` | Consumption history supports the 14-day rate and buffered projection. |
| `PREDICTION_INSUFFICIENT_HISTORY` | `windowDays: 14`, `minimumDistinctDays: 2`, `requiredSpanDays: 7` | Prediction is on but history does not yet qualify; thresholds apply. |
| `QUANTITY_BUY_TO_TARGET` | `quantity` decimal string, `unit`, `targetStock` decimal string | Suggested amount reaches the target for ordinary quantity tracking. |
| `QUANTITY_BUY_TO_MEET_OR_EXCEED_TARGET` | `quantity` decimal string, `unit`, `targetStock` decimal string | Suggested whole-package amount may exceed the target for opened tracking. |
| `FIVE_LEVEL_CURRENT_AND_BACKUPS` | `level` stock-level code or `null`, `backupCount` integer | Current five-level state and refill count. |
| `PRESENCE_CURRENT_AND_BACKUPS` | `present` boolean or `null`, `backupCount` integer | Current presence and backup count. |
| `STATE_OPEN_BACKUP_BEFORE_BUY` | — | A backup can be opened for the absent/empty current item. |
| `STATE_BUY_REFILL_NO_BACKUP` | `neverRunOut` boolean | No backup remains and a refill is recommended. |
| `FIVE_LEVEL_AT_LOW_THRESHOLD` | `lowAtLevel` stock-level code | Current level reached the configured Low level. |
| `STATE_NO_PURCHASE_NEEDED` | — | Current state and backups do not call for a purchase. |
| `PREDICTION_NOT_APPLICABLE` | — | Quantity consumption prediction does not apply to a state item. |

For state modes, `expiryExplanation` and `suggestion` remain `null`; `recommendedAction` and `purchasePriority` remain the server's action decisions. Their action message is the final `reasonExplanations[]` entry. No expiry or quantity prediction is invented for those modes.

Home `items[]` adds `primaryExplanation: Explanation` and `supportingExplanations: Explanation[]`. The server selects the primary descriptor from the same action and priority choice it uses today: Use Soon leads with expiry; a state Buy or Open refill leads with its action reason; a quantity Buy or Low item leads with its first stock reason. Other applicable stock and expiry descriptors are supporting explanations. Home's existing English `reason` and `reasons`, risk flags, action, priority, ordering, and four-item limit remain unchanged. For example, a critical Buy item that also expires soon has a Buy primary descriptor and a `QUANTITY_USE_SOON` supporting descriptor.

This addition covers live assessments and Home only. Existing HTTP error `message` fields still include English prose (for example invalid shopping date and Inventory filter errors), while some endpoints already return machine-readable error codes. Persisted Shopping Trip `suggestedReason` snapshots, including skipped-previous-trip reasons, remain English strings and are not rewritten or localized by these descriptors. Error localization and future Shopping snapshot descriptors require a separate contract and migration plan. Existing English reason fields remain available during FE adoption.
