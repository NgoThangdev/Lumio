# Lumio Phase 1 Technical Design

## Purpose and authority

This document records a planning-level technical design for Lumio's first usable release. It is not an implementation, a Prisma schema, an API contract, or a detailed UI specification. The approved [Phase 1 scope](phase-1-scope.md) defines what belongs in the release; the [master prompt](master-prompt.md) is authoritative if the sources conflict. The [product overview](product-overview.md) summarizes the low-effort household workflow but adds no separate requirements. Technical proposals and assumptions below do not change product scope.

## Original planning baseline (historical)

This document began before application code existed. Its proposed routes, milestones, and open decisions below record the original plan, **not the current repository or deployment status**. Use the API contracts, source, migrations, and tests to determine current behavior. Do not treat an old “proposed” or “not implemented” statement here as a current gap.

## Confirmed Phase 1 requirements

- Deliver a mobile-first React/TypeScript PWA, a NestJS/TypeScript API, PostgreSQL, and Prisma schema and migrations; support simple email/password authentication and household Admin/Member authorization. A user can participate in, manage, or follow multiple households in Phase 1. Admin or Member is the user's role within each household membership, not a global account role; these are the only Phase 1 roles. Admins can invite and remove members of their household.
- Keep category, location, tag, logical inventory item, and stock batch distinct. Support quantity and five-level stock tracking, relevant dates and opened state, FEFO consumption, fast actions, activity history, and feasible Undo. Allow presence/backup mode in the stock model with simpler Phase 1 UI support.
- Provide an action-first Home, searchable and filterable Inventory, item detail, and location stock check. Calculate basic low-stock and expiry risk separately; use the 14-day rolling consumption average and approximately 20% buffer where prediction is enabled, with threshold fallback for insufficient history.
- Support Shopping Trips, automatic suggestions and Must/Should/Optional classification, pre-shopping checks, shopping mode, actual purchased quantities, automatic restock on completion, and Quick Purchase.
- Provide basic settings, per-user notification preferences, backend-driven Web Push, and notification deep links. Make the PWA installable with sensible offline shell behavior. Do not silently lose offline actions.

These are requirements from the master prompt and approved scope, not choices made by this design. Features listed in the scope's `Out of Phase 1` section remain outside this design.

## Proposed architecture and conceptual domain relationships

Use the existing `apps/web` directory for the React PWA and `apps/api` for the NestJS API. Use PostgreSQL and Prisma for persistence. Keep stock-changing rules and authorization checks on the server; apply inventory changes with database transactions and safe updates so concurrent household actions cannot make client state authoritative. `packages/shared` may hold shared contracts if useful, while business rules stay in the API. This use of the directories and package boundary is a technical proposal.

| Conceptual relationship | Meaning |
|---|---|
| Household — Membership — User | A user can have memberships in multiple households. Each membership links the account to one household and carries its Admin or Member role; the account has no global household role. As a technical proposal, a newly registered account may temporarily have no membership before creating a household or accepting an invitation. |
| Household — Invitation — Membership | An Admin-created invite link belongs to a household and is not bound to a recipient email. Any authenticated account holding it may explicitly accept it to create a Member membership there; opening the link alone does not consume it. |
| Household — Category, Location, Tag | These are separate household-level dimensions, not variants of one concept. |
| Household — Inventory Item | An item is the logical product. It normally has one primary category and may have multiple tags, tracking rules, thresholds, and target stock. |
| Inventory Item — Stock Batch — Location | An item may have multiple batches and occupy multiple locations through those batches. Batches represent stock without requiring one record per physical unit. Relevant quantity or state, opened information, and dates accompany the affected stock. |
| Inventory Item — Inventory Action — User | Meaningful changes have an attributable actor and history. An action can affect batch stock through FEFO and supports consumption calculations and feasible Undo. |
| Household — Shopping Trip — Shopping Entry — Inventory Item | A trip owns its shopping entries. Entries need the recommendation, classification, overrides, actual purchased quantity, and outcome as applicable. An ad-hoc Quick Purchase does not require a trip. |
| User — Notification Preferences and Push Subscriptions | Preferences are per user; subscriptions are per user/device. |

Low-stock health, expiry risk, consumption rate, and shopping recommendations are distinct calculations over stock, configuration, and activity. Whether any result is cached is undecided. This table describes relationships only; it does not fix tables, fields, keys, cardinality beyond stated product semantics, or migrations.

### Confirmed first quantity-based Use slice (user decision)

These rules specify this first Use flow within the broader Phase 1 inventory requirements; they do not define other tracking modes or unit conversion.

- Quantities may be fractional and are stored in the inventory item's primary unit for this slice. The user enters the quantity to use, not batch selections.
- Reject Use requests with more than six fractional digits without rounding. Give a clear validation reason that identifies the six-decimal-place limit so the UI can explain the rejection; rejected requests must not change stock or create activity.
- Allocate automatically from non-expired batches by earliest expiry first (FEFO). Batches without an expiry date follow dated eligible batches; use batch creation time to order batches deterministically.
- Do not automatically consume expired batches. If eligible stock is insufficient, reject the entire action without changing stock or recording activity.
- On success, record one attributable `USE` action and its per-batch allocations in the same database transaction as the batch stock decrements.
- Concurrent Use actions must not make batch stock negative. Allocate from current database state, not a client-supplied stock total.

### Confirmed shared batch-allocation semantics (user decision)

- `ActionBatchAllocation` is temporarily shared by `USE` and `RESTOCK`. Allocation quantities remain positive; the action type determines direction: `USE` decreases batch stock, while `RESTOCK` increases it. Split this structure later only if it becomes necessary.
- Consumption calculations count `USE` actions and, for the later opened-stock slice, `FINISH_OPENED` actions because Finish consumes the remainder. Positive `RESTOCK` and `OPEN` transfers do not count as consumption.

### Proposed first quantity-based Restock slice (technical proposal)

The master prompt requires recording actual purchased quantities and restocking inventory. The following limited operation for one existing item is a technical proposal, not a separately specified product flow:

- Take the actual purchased quantity, create a new batch for that item with that positive quantity and an optional expiry date, and record one `RESTOCK` action with one positive allocation to the new batch.
- Commit the new batch, action, and allocation in one database transaction, so a failure leaves none of them recorded.

Shopping-trip integration and other restock details remain outside this first slice.

## Proposed API boundaries, screens, and backend modules

The route shapes are navigation examples for planning, not final URLs or endpoint contracts. API operations should be organized around the listed responsibilities; exact request and response formats remain undecided.

| Backend module / API boundary | Responsibility | Proposed frontend route or screen |
|---|---|---|
| Auth | Email/password sign-in and account session | `/sign-in` |
| Households and Authorization | Household creation, multiple memberships per user, household-specific Admin/Member checks, Admin creation and revocation of manually shared invite links, authenticated explicit acceptance by any link holder, and removal of members; as technical proposals, deny household data to accounts without membership and prevent removal of the last Admin | `/household/setup`; household selection and member-management screens in settings; invite acceptance screen |
| Catalog | Categories, locations, tags, and inventory defaults | `/settings` |
| Inventory | Items, batches, detail, search, filters, grouping, and location checks | `/inventory`, `/inventory/new`, `/inventory/:itemId`, `/inventory/locations/:locationId/check` |
| Inventory Actions and Activity | Use, open, finish, update level, restock, feasible Undo, and attributable history | Item quick actions, item history, recent activity |
| Stock Intelligence | Low-stock and expiry status, 14-day rate, and safety buffer | `/` Home attention items; inventory and item status |
| Shopping | Suggestions, trips, pre-check, checklist, Quick Purchase, completion, and restock | `/shopping`, `/shopping/trips/:tripId`, `/shopping/trips/:tripId/check`, `/shopping/trips/:tripId/shop`, `/shopping/quick-purchase` |
| Notifications | Preferences, device subscriptions, scheduled evaluation, delivery, and deep-link targets | `/settings`; relevant item or action screen |

Home, Inventory, Shopping, and More/Settings are the priority navigation areas. Inventory Actions owns transactional stock changes and FEFO allocation. Shopping invokes that boundary for trip completion and restock. Domain rules belong in services rather than HTTP controllers. These module boundaries are proposals, not additional product capabilities.

## Original dependency-ordered implementation milestones (historical plan)

This order largely follows master prompt §43: Foundation, Inventory Core, Inventory UI, Shopping, Intelligence, Notifications, and Polish. It moves **Stock Intelligence before the completed Shopping feature** because prediction-driven shopping suggestions depend on stock-intelligence calculations. A basic quantity-to-target suggestion can use current stock and target stock directly, without consumption prediction. Inventory UI and a Home skeleton can still be built before those calculations; Home's full attention and trip summaries follow their dependencies. Business-rule tests are placed where the rules enter the system, rather than deferred to release polish.

1. **Foundation.** Establish the applications, PostgreSQL/Prisma migrations, email/password authentication, households, multiple memberships per user, Admin-created manually shared invite links and member removal, and two-role authorization per membership. Test household isolation, differing Admin/Member roles for the same user across households, permission boundaries within each household, and that only its Admins can create or revoke links or remove its members. Test that any authenticated link holder may explicitly accept without an email match, opening alone does not consume the link, and acceptance after sign-in or email/password registration grants Member only. Test seven-day expiry, revocation, and rejection of link reuse after successful acceptance. For the technical defaults below, test that a newly registered account without membership cannot access household data and that the last Admin cannot be removed.
2. **Inventory core.** Add distinct catalog, item, and batch concepts; quantity, five-level, and presence/backup modeling; opened state and dates; transactional quick actions, FEFO, activity, and feasible Undo. Test FEFO batch selection, opened and five-level transitions, actor attribution, concurrent changes that must not produce invalid negative stock, and reversal of stock effects for any quick actions chosen as Undo-eligible. The eligible actions and Undo window remain open decisions.
3. **Inventory UI.** Add mobile navigation, a Home skeleton, minimal item creation, inventory list/search/filter/grouping, item detail, and location stock check. Verify these flows against the API behavior and role boundaries.
4. **Stock intelligence.** Add low-stock and expiry calculations, the 14-day rolling average, approximately 20% safety buffer, and insufficient-history threshold fallback. Test backup effects, stock status, rolling-rate calculation, fallback, and opened-item expiry rules.
5. **Shopping.** Add trips, recommendations and classifications, pre-shopping checks, shopping mode, actual quantities, Quick Purchase, and automatic restock. Complete Home attention and trip summaries. Test target-stock suggested quantities, overrides and skipped items, and correct restock batches and activity when a trip finishes.
6. **Notifications and settings.** Add household and inventory settings, per-user preferences, device subscriptions, backend Web Push evaluation, and deep links. Test preference filtering and the notification-tap path to the relevant item/action without relying on notification buttons.
7. **Release quality.** Add installable PWA assets, offline-shell and failure messaging, illustration placeholders, demo data, accessible mobile states, and broader integration checks. This supplements the rule tests in earlier milestones.

## Assumptions, open decisions, and blockers

Confirmed household multiplicity: a user may participate in, manage, or follow multiple households in Phase 1. Admin and Member remain the only roles, assigned through each household membership rather than globally to the user.

Confirmed invitation mechanism (user decision): An Admin creates a one-time invite link and manually shares it; Lumio does not send invitation emails. The link is not bound to a recipient email: any authenticated account possessing it may explicitly accept it. It expires seven days after creation, and an Admin may revoke it before use. The invitee must sign in or register with email/password before accepting. Opening the link does not consume it. Only successful authenticated explicit acceptance adds the invitee to that household as a Member and consumes the link so it cannot be reused; the link cannot grant Admin.

### Decisions recorded as open in the original plan

The Undo boundary and stock-calculation rules have since been refined in focused slice documents and API contracts. Check those current contracts before treating either row below as unresolved.

| Decision | Planning assumption and reason for review |
|---|---|
| Undo boundary | The scope requires Undo for recent quick actions where feasible but does not define eligible actions or the time window. Decide these before finalizing action history and client behavior. |
| Stock calculation conventions | The approximately 20% buffer, unit conversion beyond the first quantity-based Use slice, quantity precision and rounding outside that Use slice, and treatment of batches without expiry in recommendations and alerts need documented rules before those features are implemented. The first Use slice rejects requests with more than six fractional digits without rounding; no convention is asserted here for the other behaviors. |

### Technical defaults that can be documented during implementation

- For the first quantity-based Use slice, evaluate batch expiry dates in `Asia/Ho_Chi_Minh`. A batch remains eligible throughout its expiry calendar date and becomes expired on the following calendar day. This is an approved technical default, not a master-prompt requirement; per-household timezone support is deferred to a later phase.
- Allow a newly registered account to have zero household memberships temporarily until it creates a household or accepts an invitation; deny it access to household data without membership. This is a technical proposal for the registration-to-acceptance gap, not an additional role.
- Prevent an Admin action from removing a household's last remaining Admin. This is a technical proposal to preserve household administration, not a new permission.
- Start with REST-style API boundaries and a server-managed sign-in session. Exact URLs, payloads, session transport, and expiry are technical design choices, not specified product behavior.
- Start without full offline inventory mutation synchronization, which master prompt §47 does not require. Show clearly when an action was not saved and do not silently lose it.
- Use deterministic calculations and configurable-threshold fallback; do not add AI/ML or advanced habit learning.
- Use the existing `apps/*` layout and select workspace tooling during foundation setup.

This was a planning document. Deployment and browser verification must be assessed separately against the current environment.

## Traceability

| Design area | Master prompt | Approved Phase 1 scope |
|---|---|---|
| Stack, household access, and authorization | §§2, 5, 41, 43–44 | Foundation and household access |
| Distinct entities, tracking, batches, dates, FEFO, actions, and concurrency | §§6–12, 34, 45–46 | Inventory catalog and stock; Inventory views and actions |
| Inventory screens and low-effort flows | §§16–20, 40 | Inventory views and actions; Mobile presentation |
| Stock health, expiry, and consumption rules | §§14–15, 28–29 | Stock health and Home |
| Trips, suggestions, shopping, and restock | §§21–27 | Shopping and restocking |
| Notifications, settings, and installable PWA behavior | §§30–33, 47 | Notifications and settings; Mobile presentation |
| Milestone sequence, verification, and demo data | §§43, 48–49 | All `In Phase 1` groups |

The product overview's **Stock → Use → Predict → Alert → Plan shopping → Buy → Restock → Stock** loop guides the dependency order and low-effort emphasis. It does not override the master prompt or expand the approved Phase 1 scope.
