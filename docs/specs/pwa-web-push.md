# Lumio Phase 1 — PWA and Web Push design

## Authority and status

This design refines `master-prompt.md` §§2, 30–33, 41 and 47 and `phase-1-scope.md`. The product requirements are an installable PWA, a service worker, server-evaluated Web Push, per-user preferences and subscriptions, low-noise immediate/digest/passive notification levels, and actionable deep links. This document is an approved direction, **not** a claim that any part is implemented. Any rule marked **technical proposal** needs validation during its implementation slice.

Confirmed Phase 1 defaults:

- Use `Asia/Ho_Chi_Minh` for local calendar decisions. Per-household timezones may be added later.
- Send at most **one daily digest per user**, combining eligible alerts from every household in which that user has an active membership. Do not silently send one digest per household.
- Keep NestJS authoritative for stock, expiry, recipients, and alert decisions. The React app and service worker never recompute these business rules.
- Do not require notification action buttons or offline stock mutation sync. A tap on a notification must still reach a relevant item, trip, or digest view.

## Architecture and ownership

```text
Inventory / Shopping data → NestJS evaluator → user preference + membership + quiet-hours filter
  → deduplicated notification intent → delivery per active device subscription
  → browser push service → Lumio service worker → notification tap → guarded app route
```

React registers the service worker, presents install/offline/permission states, and lets the signed-in user manage preferences and this browser's subscription. The service worker caches only the shell/static assets, receives push, displays a notification, and focuses or opens a same-origin app URL when tapped. NestJS schedules evaluation and sends push; PostgreSQL stores preferences, subscriptions, intents, and delivery attempts. Passive stock/activity information stays in the app and is not a push event.

## PWA and offline contract

- Provide a manifest with stable app identity, name, display mode, start URL, and placeholder icons; provide a service worker under an app-wide scope. Test installation in a production-like HTTPS origin as well as localhost.
- Cache versioned, public app-shell assets. Keep authenticated `/api` requests network-only; do not cache another user's household data or return stale stock as current. Do not queue Use, Restock, Shopping Finish, or other mutations offline in Phase 1.
- When offline, show that server data is unavailable and a submitted action was **not saved**. Allow explicit retry after reconnection. Never show a success state for a mutation that did not reach the API.
- The installable shell, push permission, and actual subscription are different states. Registration must not automatically request notification permission. Permission is requested only after a user gesture in Settings. Unsupported or denied push leaves the app usable with passive in-app information.

## Notification policy

| Level | Phase 1 behavior |
| --- | --- |
| Immediate | Only urgent, currently valid conditions, such as an essential item being out or opened/expiring stock needing use today. Re-evaluate before send. |
| Daily digest | One consolidated notification per user per local day across all active households, subject to that user's enabled categories. No per-item push burst. |
| Passive | Ordinary usage and household activity appear in the app only; do not push every member action. |

**Technical proposal:** evaluate urgent candidates periodically and the digest once daily. Respect user quiet hours by deferring push until they end and re-evaluating the condition then; do not release a stale queued alert. Record an idempotency key based on user, household when applicable, kind, subject, and local day or condition transition. A scheduled run, retry, or multiple API processes must not create duplicate intents. Delivery to multiple subscribed devices is expected, but delivery attempts must be tracked independently. Push-service acceptance is not proof that a person saw the notification.

**Technical proposal:** the digest is a user-level record with household-grouped content. Its tap should open a signed-in aggregate attention view; it must not choose an arbitrary household Home. The exact digest view and schedule time remain to be specified before that slice is built.

## Data and API boundaries

**Technical proposal:** introduce these separate concepts rather than storing push state on `InventoryItem`:

| Concept | Minimum purpose |
| --- | --- |
| `NotificationPreference` | One per user: expiry, low-stock, shopping reminders, daily digest, optional household events, quiet-hours range. No push is sent before explicit browser permission and subscription. |
| `PushSubscription` | One browser installation endpoint and keys, associated with an authenticated user/session. Multiple active devices per user; remove or disable on sign-out/session expiry and on permanent push-service rejection. Never log endpoint or keys. |
| `NotificationIntent` | A deduplicated user-level decision, with kind, relevant household/item/trip IDs, date, due time, and status. A digest may reference multiple households. |
| `NotificationDelivery` | Per-intent, per-subscription send attempt and result. Enables retry and cleanup without treating a push-service response as a user-read receipt. |

**Technical proposal:** session-protected endpoints read/update the current user's preference, expose only the VAPID public key, and register/remove the current browser subscription. The private VAPID key remains server-side. A subscription endpoint must not be allowed to remain bound to a prior user after sign-out or a new user signs in on the same browser. Dispatch rechecks current membership, preference, and relevant stock before sending.

## Deep links and privacy

- Item alerts open `/households/:householdId/inventory/:itemId` with an optional quick-action hint. Trip reminders open the corresponding Shopping trip. The server still checks session and household membership; a notification grants no authorization.
- The service worker accepts only same-origin Lumio paths from notification data. It focuses an existing suitable app window or opens a new one on a normal notification tap. Action buttons are optional enhancement only.
- Preserve the full path **and query string** across sign-in so a quick-action hint survives authentication. If the item/trip no longer exists or access was removed, show a safe unavailable state rather than an unrelated Home screen.
- Keep lock-screen payloads minimal; do not expose household member email, precise stock counts, or push subscription secrets. The exact preview wording is a later UX decision.

## Sequenced implementation and evidence

1. **PWA shell:** manifest/icons, service worker, static-shell caching, explicit offline messaging, installability checks. No push permission or backend mutation.
2. **Preferences and subscriptions:** reviewed additive schema/API migration, session-bound subscription lifecycle, FE Settings integration. No scheduled sends yet.
3. **Evaluator and deduplication:** pure rule tests plus database tests for memberships, quiet hours, immediate/digest separation, changed stock, and one user across multiple households. Use a fake transport first.
4. **Delivery and deep links:** configure VAPID securely, send to test subscriptions, handle expired endpoints, test tap-through and sign-in on supported devices. Do not send to real users during development.

Before marking the slice complete, verify API and web builds, browser installation, offline behavior, permission denied/unsupported states, one-user/multiple-household digest, multiple devices, sign-out, deduplication, and an item deep link. Record which browser/device combinations were actually tested; a build alone is not end-to-end push evidence.

## External platform references (technical facts, not Lumio requirements)

- [WebKit: Web Push for Home Screen web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [MDN: PushManager.subscribe and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)
- [MDN: PWA caching trade-offs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching)
- [MDN: notificationclick event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event)
- [NestJS: task scheduling](https://docs.nestjs.com/techniques/task-scheduling)
