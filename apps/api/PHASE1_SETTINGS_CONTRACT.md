# Phase 1 household settings and stock date contract

## Household name

`PATCH /api/households/:householdId` accepts exactly `{ "name": "New name" }`. Name is trimmed, non-empty, and at most 120 characters. Only a household Admin can call it. The household row is locked during authorization and update. A pending deletion request returns `409 HOUSEHOLD_PENDING_DELETION`; the Admin must cancel that request before renaming, preserving name-based deletion confirmation. No schema change is needed.

## Household inventory defaults

Members may read `GET /api/households/:householdId/inventory-defaults`. Admins may submit a non-empty partial `PATCH` to the same route. Fields are `defaultTrackingMode`, `defaultPrimaryUnit`, `defaultLowStockThreshold`, `defaultBuyThreshold`, `defaultTargetStock`, `defaultSafetyBuffer`, and `defaultExpiryReminderDays`. A null threshold means unset; household buffer defaults to `1.2`, and reminder days default to `3`. Category overrides use `PATCH /api/households/:householdId/categories/:categoryId/inventory-defaults` and may set fields to null to inherit.

Threshold values are non-negative decimal strings with at most six fractional digits, and target must be positive. Buy ≤ low ≤ target where values are present. Buffer is a decimal string from `1` through `3` with at most two fractional digits; reminder days is an integer from `0` through `30`. Numeric thresholds need an effective `QUANTITY` mode and unit. A category threshold applies only if its effective mode/unit match the new item. Household thresholds apply only if household mode/unit match. Category takes precedence field by field; the resolved values are stored on the new item. Safety buffer and reminder days are also stored on the item. Changing defaults does not rewrite existing items. An Admin can edit an existing quantity item's thresholds, buffer, and reminder days through its existing `PUT /config` route.

## Stock batch dates

Positive quantity batches may have optional `purchaseDate` and `freezeDate` in addition to `expiryDate`; all are date-only values. Add Item `initialStock`, direct Restock, Quick Purchase, and Shopping purchase decisions accept them. Shopping Finish defaults a missing purchase date to today in `Asia/Ho_Chi_Minh`. Unknown dates on existing batches remain null. Opening a batch carries its purchase and freeze dates to the opened batch. Freeze date is informational until a separate, approved expiry policy exists; expiry, FEFO, and Use Soon still use expiry/opened dates. Dates are not accepted for five-level or presence/backup stock.

The additive migration is `20261102090000_phase1_stock_dates`. Apply it to each target database before running the updated API. It was applied to the approved local `lumio_local` database on 2026-11-02; other environments have not been migrated as part of this work.

## Deep links

A notification tap opens the relevant item page, where the user chooses and confirms a stock action. The service worker opens a new tab if an existing tab cannot navigate. An unavailable household displays an error with a link to the household list. Notification navigation never executes a stock mutation.
