# Frontend architecture

This is a navigation map for the current `apps/web` code, not a feature-completion report. Product behavior comes from [master prompt](../specs/master-prompt.md) and [Phase 1 scope](../specs/phase-1-scope.md); API request and response details come from the relevant `apps/api/*_CONTRACT.md`. Check source and tests before claiming a flow works in a deployed environment.

Contributor rules for the current frontend are in [frontend conventions](conventions.md).

## Ownership

- `src/main.tsx` initializes React, TanStack Query, i18n, appearance, and service-worker registration.
- `src/app/App.tsx` mounts the browser router, network banner, and session boundary. `SessionBoundary` verifies `/auth/me`, handles `lumio:session-expired`, and changes session state. `sessionCache.ts` clears user/household queries and mutations at session transitions. `AppRoutes` owns auth-aware route composition and signed-in return navigation; `RequireSignIn` preserves protected pathname, query, and hash.
- `SignedInShell` owns the signed-in top bar. `app/household/HouseholdBoundary` verifies the requested household against the session's household list, redirects inaccessible IDs to `/households`, and supplies validated household context. `HouseholdShell` owns household navigation and the shared workspace heading. Features consume `useHousehold` from `shared/household/HouseholdContext.tsx`, not React Router outlet internals.
- `src/features/` owns screen-specific UI and local form state: auth, households, Home, Inventory, Shopping, Settings, and aggregate Attention.
- `src/shared/api/` owns same-origin `/api` calls, client response types, errors, and query keys. NestJS remains authoritative for FEFO, stock totals, risk, suggestions, permissions, and transactional mutations.
- `src/shared/i18n/locales/{en,vi}/` contains JSON translations. Render API explanation codes through the FE translation map; do not derive business decisions from English reason strings.
- `src/shared/ui/` contains presentation components and illustration mapping. `src/index.css` owns global resets, shared layout rules, themes, and semantic tokens; styles used only by a feature stay alongside that feature (currently `features/attention/attention.css`). See [design system](design-system.md).

### Feature ownership after the presentation and data-ownership refactors

| Feature        | Current owner boundaries                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home           | `HomePage` composes `HomeAttentionSection`, `HomeQuickActions`, `HomeTripSection`, `HomeSnapshotSection`, and `HomeActivitySection`. `homePresentation.ts` contains display-only helpers; server values and ordering remain API-owned.                                                                             |
| Inventory list | `features/inventory/list/` owns `InventoryPage`, URL filters, household-scoped list queries, filter/result/insight presentation, and `ArchivedItems`.                                                                                                                                                              |
| Add Item       | `features/inventory/add-item/` owns the form, catalog and initial-stock fields, catalog option creation, field drafts, atomic create, invalidation, and post-create navigation. The list composes this flow through relative imports within the Inventory feature.                                                 |
| Item Detail    | `features/inventory/item-detail/` owns route data and identity, stock summary, assessment, history, management, lifecycle, quantity/opened/state actions, Undo, and configuration. Action eligibility and stock rules remain server-sourced.                                                                       |
| Shopping       | `ShoppingPage` owns route composition and coordinates focused query/mutation hooks, draft state, and presentation modules. The stock-check panel and Quick Purchase remain separate flow owners within the Shopping feature.                                                                                       |
| Check Location | `features/inventory/location-check/` owns `LocationStockCheckPage` location route/query scope, API order, progress and navigation; cards compose stock summaries, decisions, correction forms, and the API-provided batch editor. The decision hook owns per-item drafts and revision-aware Confirm/Correct state. |
| Settings       | `SettingsPage` owns section order and household selection context. Account preferences, browser Push, appearance/language, offline status, sign-out, household defaults, and catalog/category controls are composed from focused sections with their own scope and permissions.                                    |

These are code ownership boundaries, not new product or authorization rules. Prefer feature-local orchestration when refresh/error semantics differ; move code to `shared` only when multiple features use the same behavior with the same semantics.

## Routes

| Route                                                  | Screen                                      |
| ------------------------------------------------------ | ------------------------------------------- |
| `/sign-in`, `/invite/:secret`                          | Authentication and invite acceptance        |
| `/households`                                          | Household selection and creation            |
| `/households/:householdId/home`                        | Home and server-prioritized attention       |
| `/households/:householdId/members`                     | Members and invitations                     |
| `/households/:householdId/inventory`                   | Inventory list, filters, grouping, Add Item |
| `/households/:householdId/inventory/:itemId`           | Item detail and stock actions               |
| `/households/:householdId/locations/:locationId/check` | Location stock check                        |
| `/households/:householdId/shopping`                    | Shopping trips                              |
| `/households/:householdId/shopping/:tripId`            | Trip detail and checklist                   |
| `/households/:householdId/shopping/quick-purchase`     | Quick Purchase                              |
| `/settings`, `/attention`                              | Preferences and cross-household attention   |

`/households/:householdId` redirects to Home. Protected routes verify the session and household membership before rendering their feature route. A notification deep link still passes through those guards. `/invite/:secret` remains a public read-only preview; its route passes session identity to the feature, which accepts only after an explicit user action.

## State, offline, and integration boundaries

TanStack Query caches server reads under household, item, or trip keys. A successful mutation invalidates affected reads; the UI must not treat its own predicted stock as authoritative. Session transitions remove every non-session query, clear mutation state, then set the session query. Sign-in supplies the returned user; sign-out first requires API success; a protected API 401 dispatches the session-expired event and routes the user through sign-in. Protected return paths retain pathname, query, and hash and are restricted by `authReturnPath` to supported internal routes. Stock writes, Shopping Finish, and check corrections are API operations, not offline-queued actions. The service worker supports the static shell; authenticated API data is network-only. When offline or a mutation outcome is uncertain, the UI must say so rather than claim it was saved.

For physical placement, use the server's batch locations and preferred future Restock location; a preference is not the location of all existing stock. See [location-aware stock writes](location-stock-writes.md). For notification and PWA behavior, check current code and [the API contract](../../apps/api/NOTIFICATIONS_CONTRACT.md) before changing registration or delivery behavior.
