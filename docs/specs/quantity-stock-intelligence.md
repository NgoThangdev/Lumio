# Quantity stock intelligence: first slice

This file records implementation choices for the current quantity-only slice. The [master prompt](master-prompt.md) remains authoritative. These exact fallback and presentation rules are technical defaults, not additional master-prompt requirements.

## Stock and expiry

- **Physical stock** is the sum of positive quantities in every batch, including expired batches. **Eligible stock** excludes batches whose expiry date precedes today's calendar date in `Asia/Ho_Chi_Minh`. An expiry-day batch stays eligible through that local day, matching FEFO Use.
- **Expired stock** is reported separately. **Use Soon** means a positive eligible batch expires today or within the following three local calendar days. It reports the quantity and date. Use Soon alone never changes the low-stock state and never creates a purchase suggestion. Undated batches have no expiry signal.

## Consumption and low stock

- Prediction uses `USE` and `FINISH_OPENED` consumption actions from the 14 local calendar dates ending today. `RESTOCK` and `OPEN` are never consumption. The rolling daily rate is their summed quantity divided by 14. Projected need is that sum divided by 14, multiplied by the number of days until the shopping date, then multiplied by **1.20**. The opened-stock slice adds `FINISH_OPENED`; existing quantity items still produce only `USE` consumption actions.
- The shopping date uses an explicit request date first, then the earliest upcoming non-restocked trip in the household, then today plus the household's default shopping cycle (7 days for existing households). Explicit dates and the cycle remain within the 30-day planning horizon. See the [household shopping settings contract](../../apps/api/HOUSEHOLD_SHOPPING_SETTINGS_CONTRACT.md). This supersedes the original temporary seven-day fallback.
- **Insufficient history technical rule:** prediction requires USE on at least two distinct local dates in that 14-day window, with at least one date seven or more calendar days before today. Until then, or when prediction is off, configured thresholds determine risk. Sparse or old history does not become a confident forecast.
- Decimal arithmetic is used throughout. Displayed daily rate and projected need are rounded **up** to six decimal places; this rounding affects only derived estimates. Entered stock quantities retain the existing no-rounding validation.
- Risk precedence is `OUT` when eligible stock is zero; `BUY` when eligible stock is at or below a configured minimum or buy threshold, or below projected need; `LOW` when it is at or below the low threshold; otherwise `OK`. Missing thresholds do not trigger. `neverRunOut` elevates any buy-risk suggestion to Must Buy; out-of-stock suggestions are also Must Buy. Other suggestions are Should Buy.

## Suggested quantity

- A suggestion appears only with buy risk and a configured target greater than eligible stock. Ordinary quantity items suggest exactly `targetStock - eligibleStock` in the primary unit. For opened-tracking package-count items, a positive gap rounds up to whole containers; the reason says the suggested amount meets or exceeds the target. Target stock can be set without requiring every threshold. If buy risk exists but target stock is missing or already met, the assessment shows the risk and no purchase quantity.
- Suggestions are read-only calculations. They create no shopping entry, trip, reservation, or stock mutation. Quantity overrides belong to the later shopping workflow.
- Item stock settings are household Admin configuration. Household members can view assessments and perform existing inventory actions.

This document records the original quantity intelligence slice. The later [opened quantity contract](../../apps/api/OPENED_QUANTITY_CONTRACT.md) adds opened-stock expiry and Finish consumption rules; other Phase 1 gaps are tracked separately.
