# Item stock correction — Phase 1 clarification

## Authority and status

The owner clarified on 2026-10-23 that an incorrect starting stock value must be correctable after Add Item. This refines the [master prompt](master-prompt.md) and [Phase 1 scope](phase-1-scope.md). Item Detail now links to a focused view of the existing Check Location correction flow; no dedicated API endpoint or migration was added. API/database tests and web build passed in the implementation handoff, but the new browser interaction has **not yet been smoke-tested**. Historical batches without a location cannot be corrected through this location-scoped path; the UI must not guess their placement.

## Product behavior

- From Item Detail, a household member can correct the **observed stock now** without deleting the item or re-entering its catalog data. Cover QUANTITY, FIVE_LEVEL, and PRESENCE_BACKUP.
- Show the current value first. For one unambiguous quantity batch at one location, let the user enter the corrected quantity directly. If multiple locations, batches with different expiry/opened states, or separate current/backup placements make a total ambiguous, ask only for the affected location or batch values. Never apply FEFO to an observation; FEFO is for Use.
- A correction may increase or decrease stock. It must not be recorded as Use, Restock, a purchase, or consumption. Keep the original `INITIAL_STOCK`/`INITIALIZE` action and append actor, time, before/after values, and affected batches or state. Existing historical shopping entries and actions are not rewritten.
- Recalculate current stock health and future suggestions from corrected stock. Already imported Shopping Trip suggestions remain snapshots. Do not count the correction toward the 14-day usage rate.
- Validate the tracking mode, quantity precision, nonnegative stock, opened-package constraints, household membership, and expected stock revision on the server. A stale view must prompt a fresh review rather than silently overwrite another member's change. Commit stock and correction history together.

Example: a member created eggs with 12 in one batch but observes 8. Correcting it leaves the Add Item history at 12, sets that batch to 8, and records a correction from 12 to 8. It does not create a `USE 4` event or affect usage prediction.

## Implementation boundary to resolve

Prefer reusing the existing Check Location correction engine and audit semantics rather than building a second stock writer. The Item Detail entry point may call that API or a thin item-scoped façade; choose the smallest route that handles an item in several locations and state items whose current and backup placements differ. This is a **technical proposal**, not a new product rule. Do not treat metadata `PATCH /items/:id` or two-minute Undo as stock correction.

## Definition of Done

- A member can correct a just-created quantity item's initial value (including an item created with zero stock), refresh, and see the corrected batch, assessment, and activity. No false Use/Restock is created.
- Five-level current level and backup count, and presence/backup current presence and backup count, can be corrected, including downward backup corrections.
- Multi-batch, multi-location, and opened stock cannot be silently changed by an ambiguous total. Correction outside the chosen location is rejected.
- Invalid values, nonmembership, and stale revisions leave both stock and correction history unchanged. Concurrent corrections cannot overwrite each other unnoticed.
- FE shows a clear success/error result, refreshes affected Home, Inventory, Item Detail, stock intelligence, and Shopping reads, and never claims an unsaved correction succeeded.
