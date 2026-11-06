# Household pending-deletion access boundary

An active household has all three deletion fields null. A pending household has `deletionRequestId`, `deletionRequestedAt`, and `deletionDueAt` set. Existing households remain active after the additive migration. The API supports impact preview, seven-day scheduling, Admin pending discovery, cancellation, and immediate Admin deletion of an ACTIVE household. A separate internal service boundary supports dry-run and explicit-ID execution for a due scheduled deletion. No public purge route, startup timer, or scheduled worker is enabled; the due date alone does not trigger purge.

For a current member, an ordinary household operation against a pending household returns `409 HOUSEHOLD_PENDING_DELETION`. The server checks membership first, so a nonmember receives the existing permission denial rather than pending-state information. The same-household Admin role remains required where it was already required. Normal `GET /api/households` omits pending households. The pending household, its inventory, history, trips, members, and shared User accounts remain unchanged.

| Boundary                                                                                                        | Read consistency / pending behavior                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/households` normal selector                                                                           | Deliberately eventual global list: filters pending rows in the list query. It may reflect the state at its query instant.                                                                        |
| Shopping settings, member list, invitation list, scoped invitation creation/revocation/removal                  | Transaction-protected household read or mutation. Pending rejects.                                                                                                                               |
| Public invitation preview and authenticated acceptance                                                          | Transaction-protected invitation and Household lock. Pending returns `410 INVITATION_HOUSEHOLD_UNAVAILABLE` without a name; no invitation is consumed.                                           |
| Category, Location, Tag list                                                                                    | Transaction-protected read. Catalog changes use the mutation gate.                                                                                                                               |
| Inventory simple list/detail (including archived Admin detail), filtered/grouped list                           | Transaction-protected read. The filtered/grouped view holds one household lock through assessment, item, and location queries.                                                                   |
| Inventory stock settings/actions, Undo, metadata, Archive/Restore/permanent item deletion                       | Transaction-protected mutation. Pending rejects.                                                                                                                                                 |
| Location stock-check and pre-shopping stock-check list                                                          | Transaction-protected read. Confirm/Correct use the mutation gate.                                                                                                                               |
| Stock intelligence and Home Needs Attention                                                                     | Transaction-protected assessment; Home ranks the captured assessment in memory.                                                                                                                  |
| Home recent activity                                                                                            | Transaction-protected read across action, Undo, trip, and check histories.                                                                                                                       |
| Shopping trip list/detail                                                                                       | Transaction-protected read. Create, import, entry decisions, start, Finish, and Restock use the mutation gate.                                                                                   |
| `/api/me/attention` and internal notification assessment                                                        | User-level aggregation locks each member household in sorted order in one read transaction, then assesses it; pending households are omitted. Another active household can remain in the result. |
| Notification intent creation, revalidation, preflight, dispatch                                                 | Assessment uses the locked read above; insertion and dispatch recheck active households with their own locks. A queued pending-household alert is not sent.                                      |
| Sign-in/out, `/api/auth/me`, household creation, user-level preferences and browser Push Subscription lifecycle | Deliberately global/user-level; available without a household lock.                                                                                                                              |

The mutation boundary checks membership, takes a compatible `Household FOR SHARE` lock in the same transaction, rechecks membership after the lock, and checks pending state before any Trip, Item, or Catalog lock or write. A future deletion-request transition must take `Household FOR UPDATE`; this serializes an in-flight write and the pending transition. Public invite preview uses a household lock without membership but never returns its name when pending. Notification insertion and dispatch lock active households before item rows; dispatch holds the household lock through the transport attempt to prevent a send after the pending transition commits.

Strict scoped reads use the same membership-first gate and hold `Household FOR SHARE` through the relevant data query. A read already in progress may finish before a pending transition can commit; a read arriving behind that transition waits and then rejects. The normal household selector and user-level operations are intentionally not a single household snapshot. Notification intent assessment is read-consistent, while eventual delivery still performs its own live revalidation.

The selector and user-level notification preflight cannot promise a state that remains current after their response: a pending transition may commit afterward. Preflight performs no send, and dispatch revalidates and locks the household before transport. No strict household-scoped read remains outside a gated read transaction.

## Deletion request API

All routes require a validated session. Only an Admin member of the requested household can preview impact, schedule, or cancel. Membership is checked before pending state is disclosed; schedule and cancel recheck Admin membership after acquiring the Household lock.

### `GET /api/households/:householdId/deletion-impact`

Returns `200 { household: { id, name }, counts }`. It is a read-only snapshot for confirmation. The read holds `Household FOR SHARE` through its counts. Pending households return `409 HOUSEHOLD_PENDING_DELETION`; Members receive `403 HOUSEHOLD_ADMIN_REQUIRED`; a nonmember receives `403 HOUSEHOLD_ADMIN_REQUIRED` without pending-state details.

`counts` has the following exact integer fields:

| Field                                                      | Included records                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `members`                                                  | All Membership rows, including Admins. Does not count shared User accounts for deletion.                                                                     |
| `invitations`                                              | Every invitation, including expired, revoked, or accepted invitations.                                                                                       |
| `categories`, `locations`, `tags`                          | All rows owned by the household.                                                                                                                             |
| `activeItems`, `archivedItems`                             | InventoryItem rows split by `archivedAt` null/non-null.                                                                                                      |
| `stockBatches`                                             | Every StockBatch belonging to an item in this household.                                                                                                     |
| `inventoryActions`, `stateActions`, `undos`, `itemChanges` | All respective history rows with this household ID.                                                                                                          |
| `shoppingTrips`, `shoppingEntries`                         | All trips owned by the household and all entries on those trips, regardless of status.                                                                       |
| `tripStockChecks`, `locationStockChecks`                   | All check rows belonging to this household's trips or household ID.                                                                                          |
| `notificationIntents`                                      | User-level intents whose scalar `householdId` matches, or whose digest `content.households[]` includes this household. A multi-household digest counts once. |
| `notificationDeliveries`                                   | Delivery rows for the matching intent rows above.                                                                                                            |

### `POST /api/households/:householdId/deletion-request`

Request body:

```json
{
  "confirmName": "Exact current household name",
  "confirmedImpact": {
    "members": 2,
    "invitations": 1,
    "categories": 3,
    "locations": 2,
    "tags": 0,
    "activeItems": 8,
    "archivedItems": 1,
    "stockBatches": 6,
    "inventoryActions": 4,
    "stateActions": 2,
    "undos": 0,
    "itemChanges": 1,
    "shoppingTrips": 2,
    "shoppingEntries": 5,
    "tripStockChecks": 2,
    "locationStockChecks": 1,
    "notificationIntents": 1,
    "notificationDeliveries": 2
  }
}
```

Every count key is required and must be a non-negative safe integer. The server recalculates all counts while holding `Household FOR UPDATE`; client counts are only an acknowledgement and are never used as data. The current household name must match exactly (case and whitespace included). On success, `201 { requestId, requestedAt, dueAt, impact: { household, counts } }`. The opaque request ID is a random 256-bit base64url value. `dueAt` equals `requestedAt + 7 × 24 hours` exactly.

Errors: `400 INVALID_HOUSEHOLD_DELETION_CONFIRMATION` or `INVALID_HOUSEHOLD_DELETION_IMPACT`; `403 HOUSEHOLD_ADMIN_REQUIRED`; `404 HOUSEHOLD_NOT_FOUND`; `409 HOUSEHOLD_NAME_CONFIRMATION_MISMATCH`; `409 HOUSEHOLD_IMPACT_CHANGED` with the fresh `{ household, counts }` in `impact`; or `409 HOUSEHOLD_DELETION_ALREADY_PENDING` for a duplicate schedule. A stale name/count acknowledgement does not schedule anything and requires a fresh review.

### `GET /api/households/pending-deletions`

Returns only pending households for which the current actor still has Admin membership, ordered by due time, then name and ID:

```json
[
  {
    "id": "household-id",
    "name": "Kitchen",
    "requestId": "opaque-token",
    "requestedAt": "...",
    "dueAt": "..."
  }
]
```

The result is read under Household `FOR SHARE` locks. The normal `GET /api/households` continues to omit pending households.

### `DELETE /api/households/:householdId/deletion-request/:requestId`

Requires current Admin membership and the exact request ID. It locks the Household `FOR UPDATE`, rechecks membership and request ID, clears all three deletion fields atomically, and returns `200 { cancelled: true, householdId, requestId }`. A changed, already-cancelled, or mismatched ID returns `409 HOUSEHOLD_DELETION_REQUEST_STALE`; non-Admins receive `403 HOUSEHOLD_ADMIN_REQUIRED`. Cancellation is allowed after `dueAt` while the request remains pending and purge has not begun. Cancellation and scheduled execution take the same Household `FOR UPDATE` lock, so only the request still present after lock acquisition can proceed.

Scheduling and cancellation do not alter household-owned rows or shared User accounts. No automatic worker or scheduler is enabled.

## Controlled scheduled purge boundary (internal only)

The `HouseholdPurgeService` exposes two internal operations for future operator tooling or a separately reviewed worker. Neither is mapped to an HTTP controller, and application startup does not invoke them. Both require an explicit non-empty `householdId` and `requestId`; there is no scan-all or implicit-current-household mode.

### Dry-run

`dryRunScheduledDeletion(householdId, requestId)` is read-only and takes a Household `FOR SHARE` lock while inspecting state. It returns `{ householdId, requestId, due, eligible, reason, dueAt }`. A matching pending request is eligible exactly when `dueAt <= current server time`; otherwise reason is `HOUSEHOLD_DELETION_NOT_DUE`. A cancelled/replaced request returns `due: false`, `eligible: false`, reason `HOUSEHOLD_DELETION_REQUEST_STALE`. A missing household returns `404 HOUSEHOLD_NOT_FOUND`; missing IDs return `400 HOUSEHOLD_PURGE_IDS_REQUIRED`. Dry-run never changes data and does not reserve eligibility: execution must recheck all conditions.

### Explicit execution

`executeScheduledDeletion(householdId, requestId)` runs one purge transaction. It takes `Household FOR UPDATE`, then rechecks that the row still has the exact request ID and is pending, and checks `deletionDueAt <= current time` after obtaining the lock. Only then does it call the same `purge(tx, householdId)` routine used by immediate deletion. Success returns `{ purged: true, householdId, requestId, purgedAt }` only after commit. It rejects stale/cancelled/replaced requests with `409 HOUSEHOLD_DELETION_REQUEST_STALE`, not-yet-due requests with `409 HOUSEHOLD_DELETION_NOT_DUE` (including `dueAt`), and missing households with `404 HOUSEHOLD_NOT_FOUND`.

Cancellation, request replacement, and execution serialize on the Household row. If cancellation commits first, execution sees the stale request and changes nothing. If execution commits first, the Household and membership are gone, so cancellation cannot claim success. Concurrent executions cannot both purge: the first removes the row; the next receives `404 HOUSEHOLD_NOT_FOUND`. Any failure—including an unknown FK or notification reference—rolls back the entire transaction. The caller should catch/log the individual household failure and continue other explicit work; the still-pending row remains retryable. No failure marker or partial completion state is written.

Operational safety: do not run explicit execution against shared, deployed, or unverified household IDs. Before a later worker is enabled, require a separately reviewed operator/worker activation, per-household failure isolation, bounded candidate selection, and audit-safe operational logging that excludes secrets. The current implementation adds no worker, scheduler, public endpoint, or startup action.

## One-shot scheduled-purge runner

The API workspace includes a standalone CLI process. It creates a Nest application context containing only Prisma and the purge service; it does not start the HTTP server or notification scheduler and exits after one batch. It is suitable as a future Render Cron Job command, but no Render service is configured or active in this slice.

Build and run the default read-only mode:

```sh
npm run build -w @lumio/api
npm run household-purge -w @lumio/api
```

The runner discovers due pending requests ordered by `deletionDueAt`, then household ID, and processes at most one batch. `HOUSEHOLD_PURGE_BATCH_SIZE` defaults to `25` and accepts integers from `1` through `100`. Dry-run prints one JSON record per candidate with only `householdId` and a result code, followed by a mode/count summary. It never prints household names, request IDs, inventory data, credentials, or notification secrets. Empty batches exit successfully.

Execution requires all of the following: `HOUSEHOLD_PURGE_EXECUTION_ENABLED=true`, a strict UTC millisecond timestamp in `HOUSEHOLD_PURGE_ACTIVATION_CUTOFF` (for example `2026-10-27T00:00:00.000Z`), and the explicit `--execute` argument. Both environment settings are absent/disabled by default, and `--execute` without them exits before connecting to the database. The cutoff means a request is eligible only if its `deletionRequestedAt >= cutoff`; older pending requests are excluded during discovery and rejected again under the Household lock. Choose the cutoff during a later activation review so enabling execution cannot replay the existing backlog. If execution is enabled in the environment but `--execute` is omitted, the invocation remains dry-run.

For a future approved cron command, the shape is `npm run household-purge -w @lumio/api -- --execute` with the enable flag, cutoff, and optional batch size supplied as environment variables. Each candidate still passes through `executeScheduledDeletion`, which locks and rechecks request ID, pending state, cutoff, and due time. Discovery is not authorization to purge. The runner catches errors per household, logs only its ID and a sanitized result code, continues the batch, and exits nonzero if any candidate execution fails. Failed transactions leave the request pending for a later retry. Because deterministic bounded discovery retries the oldest still-due failure first, repeated failures can occupy later batches; stop repeated invocations and review the failed result before resuming. No command in this task enables the runner against a shared or deployed database.

## Immediate permanent deletion

Immediate deletion uses the existing Admin impact preview. It is available only while the household is ACTIVE; an Admin must first cancel a pending seven-day request. The operation is irreversible and removes the household and its household-owned data. Shared User accounts and their sessions, preferences, push subscriptions, and memberships in other households survive.

### `DELETE /api/households/:householdId`

Requires a validated session and current Admin membership in this household. Membership is checked before household state is disclosed. The service then takes `Household FOR UPDATE`, rechecks Admin membership, requires ACTIVE state, and recalculates the complete impact before deleting anything. The request body must contain the exact current name and every count returned by `GET .../deletion-impact`:

```json
{
  "confirmName": "Exact current household name",
  "confirmedImpact": {
    "members": 2,
    "invitations": 0,
    "categories": 1,
    "locations": 1,
    "tags": 0,
    "activeItems": 1,
    "archivedItems": 0,
    "stockBatches": 1,
    "inventoryActions": 1,
    "stateActions": 0,
    "undos": 0,
    "itemChanges": 0,
    "shoppingTrips": 0,
    "shoppingEntries": 0,
    "tripStockChecks": 0,
    "locationStockChecks": 0,
    "notificationIntents": 0,
    "notificationDeliveries": 0
  }
}
```

On commit, returns `200 { deleted: true, householdId, deletedAt, impact: { household, counts } }`. A success response is produced only after the complete purge commits. Purge removes household checks and shopping entries before trips; action dependents before actions and batches; item metadata/history before items; then catalogs, invitations, memberships, and the Household. It does not delete User rows. A database or unknown-reference failure rolls back the entire transaction. Notification intents scoped only to the deleted household are deleted with their deliveries. A multi-household digest has the deleted household group removed; other groups remain only when they are still represented by an active household and current membership for that user. Its delivery history is retained when the digest still has valid content. Unsupported or ambiguous notification content blocks deletion with a conflict rather than being silently retained.

Errors: `400 INVALID_HOUSEHOLD_DELETION_CONFIRMATION` or `INVALID_HOUSEHOLD_DELETION_IMPACT`; `403 HOUSEHOLD_ADMIN_REQUIRED`; `404 HOUSEHOLD_NOT_FOUND`; `409 HOUSEHOLD_PENDING_DELETION_CANCEL_FIRST`; `409 HOUSEHOLD_NAME_CONFIRMATION_MISMATCH`; `409 HOUSEHOLD_IMPACT_CHANGED` with fresh `impact`; `409 HOUSEHOLD_PURGE_UNSUPPORTED_NOTIFICATION_REFERENCE`; or `409 HOUSEHOLD_PURGE_BLOCKED_BY_REFERENCE` if a concurrent or unmodeled foreign-key reference prevents deletion. Failed confirmations leave data untouched.

There is no deletion receipt or idempotency key. If the network response is ambiguous, refresh the normal household list: absence means the household is no longer available, but the API does not distinguish a completed deletion from a lost membership. If the household remains, fetch a fresh impact preview and require a new explicit confirmation before retrying. A retry after successful deletion receives the ordinary membership denial and does not run purge again.
