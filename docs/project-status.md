# Lumio project status — 2026-10-10

This is a handoff snapshot, not a claim that Phase 1 is complete. The [master prompt](specs/master-prompt.md) specifies the product; [Phase 1 scope](specs/phase-1-scope.md) and [technical design](specs/technical-design.md) refine it. Slice documents describe implemented technical choices. The repository is an npm workspace with a NestJS API, React/Vite web app, Prisma schema, and PostgreSQL Compose service. Much of the worktree is already staged, with additional API files untracked and web files modified; preserve it.

| Area | Specified | Implemented in repository | Migrated locally | Tested | FE integrated |
|---|---|---|---|---|---|
| Sign-in and household access | Email/password, sessions, household membership | API session auth and household creation; web sign-in/household views exist | Relevant migrations applied | Covered by prior API e2e suite | Existing views exist; no fresh browser verification in this handoff |
| Quantity inventory | Batches, FEFO Use, Restock, activity | API services and web inventory views | Relevant migrations applied | Prior API e2e suite passes | Existing quantity flow has UI; no fresh browser verification |
| Stock intelligence and Shopping Trips | USE-based prediction, suggestions, actual purchases, automatic restock | Quantity-mode API and web views exist | Relevant migrations applied | Prior API tests pass | UI code exists; end-to-end browser behavior not freshly verified |
| Five-level and presence/backup | Separate state, backup-aware health, quick actions | API state/actions and assessments; web handling exists | Relevant migrations applied | Prior API tests pass | UI code exists; no fresh browser verification |
| Catalog and atomic Add Item | Category, physical location, tags, initial stock in one operation | API catalog selectors/create and atomic Add Item for all three modes; see [contract](../apps/api/ADD_ITEM_CONTRACT.md) | `20261010091418_atomic_add_item_catalog` applied to local `127.0.0.1:55432/lumio_local` | Focused e2e 5/5, full API e2e 39/39, unit 20/20, API build/lint/format passed in prior verification | **Not yet integrated or verified.** Current web Add Item still posts the transitional name/unit/QUANTITY request and asks for a batch afterward |

Prisma status was checked for this snapshot: eight migrations are applied and the local schema is up to date. This is evidence for **local `lumio_local` only**, not another environment. The final paragraph of the Add Item contract still says its migration is unapplied; that historical note is stale. The migration and test evidence above is the current state. The web build and browser flow were not rerun for this document.

## Known gaps and next integration boundary

- Empty households have no seeded category/location choices; an Admin must currently create options before the new Add Item request can select them. FE should integrate the catalog selectors and atomic request from the contract.
- Inventory search/filtering/grouping and Home prioritization are not implemented as the full Phase 1 experience.
- Shopping Trip completion restocks quantity items only; five-level and presence/backup purchases remain outside it.
- Opened-stock state and related expiry handling, plus Undo, remain unimplemented.
- Existing direct Restock and Shopping Trip writes without a location input leave batch `locationId` unknown; they do not infer a physical place.

Before marking a slice complete, verify its API behavior, migrated target, and actual web flow together. Record the commands and environment checked in the handoff.

## Verification update — 2026-10-13

A local browser smoke against the disposable test households completed the remaining state-mode stock-check cases and captured the Quantity Restock expiry path. The temporary FE logger was narrowly scoped to method/path/body/status/response JSON and was restored byte-for-byte; it did not access credentials, cookies, or headers. No production behavior, API code, schema, or migration changed.

For draft `bf36c9fe-341e-4b02-836d-b47e2f6d888a` in household `f4252ab2-9fcb-43f7-9384-9b4d38c39c11`, FIVE_LEVEL detergent `387566e1-1ffe-4fbb-9b44-25dec4d20816` Confirmed at expected revision 3 (HTTP 200), then Corrected to HALF with 2 backups at revision 3 (HTTP 200; resulting revision 4). Item Detail GET returned HALF/2 at revision 4. PRESENCE_BACKUP tissues `40667e53-43b1-4e32-941a-9174ee6c59fc` Confirmed at revision 4 (HTTP 200), then Corrected to absent with 2 backups at revision 4 (HTTP 200; resulting revision 5). Item Detail GET returned absent/2 at revision 5. Leaving for Item Detail and returning to the draft preserved both saved corrections (2/2).

Separate Item Detail state changes advanced detergent revision 4→5 (HALF→QUARTER) and tissues 5→6 (absent→present). Each old-revision Confirm was submitted once. Both stale PUTs returned HTTP 409 with `{"message":"STOCK_CHANGED","error":"Conflict","statusCode":409}`. The subsequent stock-check GET returned both entries as `STALE`, reason `STOCK_CHANGED`, with the updated state and revisions 5 and 6. The UI displayed the refreshed values and required a new user review; no retry was sent.

For disposable Quantity item `7ffe57d5-0399-4649-83e4-5c488a9372c7` in household `6ca6979e-cf9e-41d4-b835-e2e3f78c9717`, the visible Restock date input was `2027-06-17`. UI Restock sent `{"quantity":"1","expiryDate":"2027-06-17"}`; HTTP 201 returned batch `da224d5d-4335-4c3d-9087-e3e2f284b564`, quantity `"1"`, expiry `"2027-06-17T00:00:00.000Z"`, `openedAt:null`. The subsequent Item Detail GET returned the same values for that batch. Thus the tested UI request, API response, and readback all preserve the date. The two older probe batches have null expiry, but their request/response history was not captured; the cause of those older nulls remains undetermined.

**Still unverified:** a BATCH_DETAIL_REQUIRED correction where the returned quantity batches have distinct expiry dates. The prior batch-edit smoke used no distinct expiry dates. This is a verification limit, not an observed contract or implementation defect. No web build was run because all production FE changes were restored; the requested document-only `git diff --check` was run for `docs/frontend/architecture.md` and `docs/project-status.md`.
