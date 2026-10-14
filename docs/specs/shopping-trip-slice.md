# First quantity-based Shopping Trip slice

This slice implements the core Stock → Use → Predict → Plan → Buy → Restock loop for existing quantity-based inventory items. The [master prompt](master-prompt.md) remains authoritative. The shortened lifecycle and validation details here are implementation choices for this first slice.

## State transitions

- A signed-in household member creates a `DRAFT` trip with one planned date and primary store. Suggestions can be imported while the trip is a draft. Import snapshots the current suggested quantity, priority, and reason into one entry per item. Re-importing skips existing entries and never rewrites their snapshots. Members can add existing items manually in Draft or Shopping, including items without target stock. A manual entry has no invented suggested quantity.
- Starting moves `DRAFT → SHOPPING`. Only an active Shopping trip accepts entry decisions. Each entry starts `PENDING`. Marking `PURCHASED` requires a separately entered, positive actual quantity with at most six fractional digits; an optional expiry date can accompany it. `SKIPPED` and `PENDING` clear any saved actual quantity and expiry. Suggested quantity is never treated as proof of purchase.
- Finishing moves `SHOPPING → RESTOCKED` in **one database transaction**. Pending entries become skipped. Each purchased entry creates one batch with its actual quantity, one attributable RESTOCK action, and one positive allocation through the shared InventoryService Restock boundary. Skipped entries create no stock or activity. The trip's `completedAt` and final state commit with those writes.
- A row lock on the trip serializes Finish calls; the first successful call performs the writes. Later and concurrent calls observing `RESTOCKED` return the finished trip without writing again. Purchased items are processed in stable item-ID order and share the same per-item lock used by direct Restock and FEFO Use. A validation or database error rolls back the whole completion.
- `COMPLETED` is not a separately committed state in this slice because completion and restocking are atomic. Pre-shopping check and finalized states are also deferred. This does not represent the full Phase 1 trip lifecycle.

The checklist reuses an item's saved name and primary unit. Actual quantity is entered during shopping, so Finish asks for neither name, unit, nor quantity again. No purchase price, receipt, or new item creation is involved.

## Deferred Phase 1 gaps

This original quantity slice preceded state-mode purchases and pre-shopping checks. Grouping by store section, Quick Purchase outside a trip, new-item creation during shopping, and notification flows remain separate work. This slice has no receipt OCR or prices. The later explicit `MOVED` decision and carryover contract are documented in the [Shopping API contract](../../apps/api/SHOPPING_CONTRACT.md).

The later [pre-shopping backend contract](../../apps/api/SHOPPING_CONTRACT.md) adds a short, saved stock check before a draft's first suggestion import. It leaves this slice's imported suggestion snapshots and manual entries intact; already-imported drafts are not refreshed.

The later Shopping contract also treats SKIPPED entries on the immediately previous eligible completed trip as a suggestion source during the next draft's first import. The server reassesses current stock for that draft's planned date. A skipped quantity item below target may be Optional for the gap; recovered stock, missing targets, and state items without `BUY_BACKUP` add nothing. This is recommendation context, not automatic carryover. Import remains one-shot even when it creates zero entries.
