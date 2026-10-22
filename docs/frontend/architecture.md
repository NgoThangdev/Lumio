# Frontend architecture

This is a navigation map for the current `apps/web` code, not a feature-completion report. Product behavior comes from [master prompt](../specs/master-prompt.md) and [Phase 1 scope](../specs/phase-1-scope.md); API request and response details come from the relevant `apps/api/*_CONTRACT.md`. Check source and tests before claiming a flow works in a deployed environment.

## Ownership

- `src/main.tsx` initializes React, TanStack Query, i18n, appearance, and service-worker registration.
- `src/app/App.tsx` owns routing, session and household boundaries, the shared shell, and offline indication.
- `src/features/` owns screen-specific UI and local form state: auth, households, Home, Inventory, Shopping, Settings, and aggregate Attention.
- `src/shared/api/` owns same-origin `/api` calls, client response types, errors, and query keys. NestJS remains authoritative for FEFO, stock totals, risk, suggestions, permissions, and transactional mutations.
- `src/shared/i18n/locales/{en,vi}/` contains JSON translations. Render API explanation codes through the FE translation map; do not derive business decisions from English reason strings.
- `src/shared/ui/` and `src/index.css` contain presentation components, illustration mapping, and visual tokens. See [design system](design-system.md).

## Routes

| Route | Screen |
| --- | --- |
| `/sign-in`, `/invite/:secret` | Authentication and invite acceptance |
| `/households` | Household selection and creation |
| `/households/:householdId/home` | Home and server-prioritized attention |
| `/households/:householdId/members` | Members and invitations |
| `/households/:householdId/inventory` | Inventory list, filters, grouping, Add Item |
| `/households/:householdId/inventory/:itemId` | Item detail and stock actions |
| `/households/:householdId/locations/:locationId/check` | Location stock check |
| `/households/:householdId/shopping` | Shopping trips |
| `/households/:householdId/shopping/:tripId` | Trip detail and checklist |
| `/households/:householdId/shopping/quick-purchase` | Quick Purchase |
| `/settings`, `/attention` | Preferences and cross-household attention |

`/households/:householdId` redirects to Home. Protected routes verify the session and household membership. A notification deep link still passes through those guards.

## State, offline, and integration boundaries

TanStack Query caches server reads under household, item, or trip keys. A successful mutation invalidates affected reads; the UI must not treat its own predicted stock as authoritative. Session changes clear account-scoped cached data. Stock writes, Shopping Finish, and check corrections are API operations, not offline-queued actions. The service worker supports the static shell; authenticated API data is network-only. When offline or a mutation outcome is uncertain, the UI must say so rather than claim it was saved.

For physical placement, use the server's batch locations and preferred future Restock location; a preference is not the location of all existing stock. See [location-aware stock writes](location-stock-writes.md). For notification and PWA behavior, check current code and [the API contract](../../apps/api/NOTIFICATIONS_CONTRACT.md) before changing registration or delivery behavior.
