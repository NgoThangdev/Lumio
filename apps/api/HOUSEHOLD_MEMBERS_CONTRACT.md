# Phase 1 household invitations and members

The existing session cookie identifies the actor. Household-scoped management requires that actor's `ADMIN` membership in the **specified** household. Roles remain `ADMIN` and `MEMBER`; accepting an invitation always grants `MEMBER`. A user may join multiple households but has at most one membership per household.

## Manually shared, one-time invitation

`POST /api/households/:householdId/invitations` requires an Admin session and no body. It returns `201`:

```json
{
  "id": "<invitation-id>",
  "invitePath": "/invite/<one-time-secret>",
  "expiresAt": "2026-10-24T08:00:00.000Z"
}
```

FE may prepend its own origin and let the Admin manually copy/share the link. Lumio sends no email and does not bind the link to an email. The 32-byte random secret appears **only** in this creation response and the shared link. The server stores its SHA-256 hash, never the secret; later invitation, member, and error responses do not return it. The link expires exactly seven days after creation. FE should avoid forwarding the link to third-party services.

`GET /api/invitations/:secret` is a read-only preview, available before sign-in. It returns `200` with `{ "household": { "id": "...", "name": "..." }, "status": "ACTIVE", "expiresAt": "..." }`. `status` may also be `EXPIRED`, `REVOKED`, or `USED`. Repeating preview does not consume the invitation. Unknown or malformed secrets return `404 INVITATION_NOT_FOUND`.

`GET /api/households/:householdId/invitations` requires an Admin of that household. It returns `200` with an array ordered by newest `createdAt` first, then invitation ID, for example:

```json
[
  {
    "id": "<invitation-id>",
    "createdAt": "2026-10-17T08:00:00.000Z",
    "expiresAt": "2026-10-24T08:00:00.000Z",
    "status": "ACTIVE"
  }
]
```

`status` is computed by the server at read time as `ACTIVE`, `EXPIRED`, `REVOKED`, or `USED`. The response never includes the link secret, its hash, or a reusable link. It includes only invitations for the requested household. A non-Admin receives `403 HOUSEHOLD_ADMIN_REQUIRED`; a missing session receives `401`.

`POST /api/invitations/:secret/accept` requires a valid session and an explicit user action. It returns `201 { "household": { "id": "...", "name": "..." }, "role": "MEMBER" }`. Membership creation and one-time consumption commit together. The invitation remains available if the actor is already a member (`409 ALREADY_MEMBER`). An expired, revoked, or previously accepted invitation returns `410 INVITATION_EXPIRED`, `INVITATION_REVOKED`, or `INVITATION_USED` respectively. An unknown secret returns `404`; no session returns `401`. Concurrent acceptance permits exactly one success.

`DELETE /api/households/:householdId/invitations/:invitationId` requires an Admin of that household. It returns `200 { "revoked": true }`, or `200 { "revoked": false }` if already revoked. A used invitation returns `409 INVITATION_USED`; an ID outside that household returns `404 INVITATION_NOT_FOUND`. Revocation prevents subsequent acceptance.

## Members

`GET /api/households/:householdId/members` requires a household Admin and returns `200` with an email-sorted array of `{ "id": "<user-id>", "email": "...", "role": "ADMIN" | "MEMBER" }`. This is the member display data for that household; there is no global user directory.

`DELETE /api/households/:householdId/members/:userId` requires a household Admin and returns `200 { "removed": true }`. Missing members return `404 MEMBER_NOT_FOUND`. Removing the last Admin returns `409 LAST_ADMIN`, including self-removal. Concurrent removals serialize on the household row so the last Admin remains. Admin status in one household grants no management rights in another; a missing session returns `401`, and a non-Admin returns `403 HOUSEHOLD_ADMIN_REQUIRED`.

The invitation and membership tables already contain the required fields. This slice adds no migration. FE still needs to build the link-sharing, preview/sign-in/accept, and member settings screens; browser integration has not been verified by the API tests.
