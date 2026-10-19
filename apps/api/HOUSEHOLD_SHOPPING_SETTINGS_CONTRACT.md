# Phase 1 household shopping defaults

Both endpoints require a valid session and an existing membership in the requested household. Settings belong to the household, not the user. Members may read; only that household's `ADMIN` may update.

`GET /api/households/:householdId/shopping-settings` returns `200`:

```json
{ "defaultShoppingCycleDays": 7, "defaultStore": null }
```

`PATCH /api/households/:householdId/shopping-settings` accepts a nonempty subset of these fields and returns the complete saved object. `defaultShoppingCycleDays` is an integer from **1 through 30**; `defaultStore` is a trimmed, nonempty string of at most 120 characters or `null` to clear it. Omitted fields retain their values. Unknown fields or an empty body return `400 INVALID_SHOPPING_SETTINGS`; an invalid cycle returns `400 INVALID_SHOPPING_CYCLE`; an invalid store returns `400 INVALID_DEFAULT_STORE`. No session returns `401`. A nonmember GET returns `403 HOUSEHOLD_MEMBERSHIP_REQUIRED`; a non-Admin PATCH returns `403 HOUSEHOLD_ADMIN_REQUIRED`. An unknown household returns `404 HOUSEHOLD_NOT_FOUND`.

FE can use `defaultStore` and the local date plus `defaultShoppingCycleDays` to prefill the existing Shopping Trip form. Trip creation continues to accept an explicit store and planned date. Changing defaults does **not** edit trips, imported suggestion snapshots, inventory, or activity.

## Stock-intelligence planning date

For `GET /api/households/:householdId/stock-intelligence`, the server chooses the assessment `shoppingDate` in this order:

1. Valid explicit `?shoppingDate=YYYY-MM-DD` from today through 30 local calendar days ahead.
2. The earliest trip in that household whose status is `DRAFT` or `SHOPPING` and whose planned date is today or later. Ties use trip ID order. Completed `RESTOCKED` and past trips are ignored.
3. Today plus that household's `defaultShoppingCycleDays`.

The response's existing `shoppingDate` field reports the resolved date. Calendar dates use `Asia/Ho_Chi_Minh`. The 14-day consumption window, 20% prediction buffer, thresholds, and suggestion quantity rules are unchanged. A trip's first suggestion import still supplies its own planned date and stores a one-shot snapshot; changing a household default or another trip does not rewrite it.

The additive migration gives existing households a cycle of 7 and `defaultStore: null`. It must be reviewed and applied before database tests or FE integration of these fields.
