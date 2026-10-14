# Recent Household Activity API (Phase 1 Home)

`GET /api/households/:householdId/home/activity` requires a session and membership in the URL household. Missing session returns 401; missing membership returns 403 `HOUSEHOLD_MEMBERSHIP_REQUIRED`. The endpoint is read-only and has no query parameters. It returns at most 20 events, newest first by `occurredAt`, then event ID descending for ties.

```json
{
  "items": [
    {
      "id": "inventory:<action-id>",
      "type": "USE",
      "occurredAt": "2026-10-14T10:00:00.000Z",
      "actorId": "<user-id>",
      "item": { "id": "<item-id>", "name": "Eggs", "primaryUnit": "egg" },
      "trip": null,
      "location": null,
      "quantity": "2",
      "change": null,
      "isUndone": true,
      "undoneAt": "2026-10-14T10:01:00.000Z",
      "reversesEventId": null,
      "reversesType": null
    }
  ]
}
```

The client formats display text from structured fields. `quantity` is a decimal string when applicable. `change` is `{ before, after }` for state actions and stock corrections; each side contains only relevant `currentLevel`, `isPresent`, `backupCount`, or `quantity` values. Batch-level correction detail is omitted from this compact Home feed. Original actions remain visible after Undo with `isUndone: true` and `undoneAt`; they must not be presented as still-effective consumption. Each reversal has `type: "UNDO"`, its own actor/time, `reversesEventId` pointing to `inventory:<id>` or `state:<id>`, and `reversesType` naming the original action even when it falls outside the response. All other events have `isUndone: false`, `undoneAt: null`, `reversesEventId: null`, and `reversesType: null`.

Included types:

- Quantity action: `USE`, `RESTOCK`, `INITIAL_STOCK`, `OPEN`, `FINISH_OPENED` (`id: inventory:<id>`).
- State action: `INITIALIZE`, `UPDATE_LEVEL`, `ADD_BACKUP`, `OPEN_REFILL`, `SET_PRESENCE` (`id: state:<id>`).
- Undo reversal: `UNDO` (`id: undo:<id>`).
- Finished Shopping Trip: `SHOPPING_TRIP_COMPLETED` (`id: trip:<id>`, with `trip: { id, store }`). `actorId` is the user who first finished the trip. Historical trips completed before finisher attribution have `actorId: null`; the creator is never substituted.
- Stored trip and location stock-check **CORRECT** history entries with a valid per-entry `userId` and `checkedAt`: `TRIP_STOCK_CORRECTED` and `LOCATION_STOCK_CORRECTED`. IDs use the check's stable composite key plus its append-only history index. Confirmations are omitted because they do not change stock. History entries missing actor or time are omitted rather than assigned the row's latest actor/time.

Inventory action rows written by Shopping Finish are included with their actual actor. They are not linked to a specific trip in the current schema, so the feed may show both restock actions and the trip completion without claiming a relationship. The feed does not infer the completion actor from those actions. The household API does not expose a member directory: FE can show “You” when `actorId` matches the signed-in user, “Household member” for another actor ID, and neutral unknown-member text for null legacy attribution. This response does not expose email or display names. Push notifications, pagination, and batch-level audit detail are outside this Home slice.
