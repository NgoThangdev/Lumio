# Phase 1 Notification Preferences and Push Subscription API

These endpoints require the existing `lumio_session` cookie. They derive the user and session from the validated server session. No user, household, or session ID is accepted in request bodies. They do not request browser permission or send notifications.

## Preferences

`GET /api/me/notification-preferences` returns `200`:

```json
{
  "expiryAlertsEnabled": false,
  "lowStockAlertsEnabled": false,
  "shoppingRemindersEnabled": false,
  "dailyDigestEnabled": false,
  "householdEventsEnabled": false,
  "quietHours": null,
  "timezone": "Asia/Ho_Chi_Minh"
}
```

Preferences belong to the user across all active households. Before any row exists, the server returns these safe defaults without creating a row. Every push category, including daily digest, starts disabled. The Phase 1 timezone is fixed. The approved future delivery policy permits at most one daily digest **per user across all active households**, never one per household.

`PATCH /api/me/notification-preferences` accepts a nonempty subset of the five boolean fields and/or `quietHours`. `quietHours` is either `null` to clear it or `{ "start": "22:00", "end": "07:00" }` using 24-hour `HH:mm` values; start and end must differ. The response is the complete `200` preference object above with saved values. Omitted fields retain their values (or defaults on first write). Unknown fields and nonboolean category values are rejected. Quiet-hour interpretation and delivery enforcement belong to the later evaluator slice; this endpoint stores the user's choice.

## This browser's subscription

`GET /api/me/push-public-key` requires a valid session and returns `200` with `Cache-Control: no-store`. With valid server configuration it returns `{ "available": true, "publicKey": "<base64url P-256 public key>" }`. Otherwise it returns `{ "available": false, "publicKey": null, "reason": "WEB_PUSH_UNAVAILABLE" }`. Missing or expired sessions return `401`. No response contains the VAPID private key, push endpoint, or subscription keys. FE should use the public key as `applicationServerKey` only after a user gesture and should show the unavailable state without requesting permission when `available` is false.

After a user gesture and a successful browser Push Subscription, FE sends:

`PUT /api/me/push-subscription`

```json
{
  "endpoint": "https://push.example.invalid/device-token",
  "keys": {
    "p256dh": "<base64url-P-256-public-key>",
    "auth": "<base64url-auth-secret>"
  }
}
```

Returns `200 { "registered": true }`. The endpoint must be an ASCII HTTPS URL without embedded credentials or a fragment and at most 2048 characters. `p256dh` must decode to a 65-byte uncompressed P-256 public key and be at most 512 characters; `auth` must decode to 16 bytes and be at most 128 characters. Unknown fields are rejected. Repeating the same registration is safe; updated keys replace old keys. The unique endpoint is rebound atomically to the **current validated session** if another account signs in and registers it. Multiple distinct endpoints can belong to one user's different sessions. The response does not include endpoint or keys.

`DELETE /api/me/push-subscription` with `{ "endpoint": "https://push.example.invalid/device-token" }` returns `200 { "removed": true }` if this session owned and removed it, or `200 { "removed": false }` if it did not. It cannot delete another session's subscription. FE can call the browser's `unsubscribe()` separately; this endpoint changes only server registration.

`POST /api/me/push-subscription/status` with `{ "endpoint": "https://push.example.invalid/device-token" }` returns `200 { "registered": true }` only when that endpoint belongs to the current validated, unexpired session. It returns `200 { "registered": false }` for an unregistered endpoint or one owned by another session or account. The response has `Cache-Control: no-store` and contains no endpoint, keys, session identity, or subscription list. The body must contain exactly one `endpoint` field and uses the same HTTPS endpoint validation as PUT/DELETE. A missing or expired session returns `401`; malformed input returns `400 INVALID_PUSH_SUBSCRIPTION` without echoing the submitted value. FE can call this after reload using the browser's current `PushSubscription.endpoint`.

Successful sign-in or registration replaces this browser's previous cookie session: the server deletes that previous session and its subscriptions through the foreign key cascade before returning the new cookie. Rejected credentials leave the previous session and subscriptions intact; sessions on other devices are unaffected. Sign-out deletes the current session and its subscriptions. An expired session cannot register again and is excluded from the internal delivery-subscription query even if its row has not yet been pruned. No HTTP subscription list or preference response exposes endpoint or key secrets. The server must not log them.

## Errors and remaining scope

- `401` for no valid session, including an expired session.
- `400` with message `INVALID_NOTIFICATION_PREFERENCE` for empty, unknown, or mistyped preference fields.
- `400` with message `INVALID_QUIET_HOURS` for malformed quiet-hour ranges.
- `400` with message `INVALID_PUSH_SUBSCRIPTION` for malformed, oversized, or unknown subscription fields. The error never echoes the endpoint or keys.

## Current attention for the digest destination

`GET /api/me/attention` requires a valid session and returns `200` with `Cache-Control: no-store`:

```json
{
  "asOf": "2026-10-15T02:00:00.000Z",
  "households": [
    {
      "householdId": "household-id",
      "name": "Home",
      "items": [
        {
          "itemId": "item-id",
          "name": "Rice",
          "trackingMode": "QUANTITY",
          "signals": ["LOW_STOCK"],
          "lowStockRisk": "LOW",
          "expiryRisk": "NONE"
        }
      ]
    }
  ]
}
```

The server computes this response from **current** stock assessments and active household memberships on each request; it never reads a stored NotificationIntent snapshot. The read is useful even when push preferences are disabled. `LOW_STOCK` follows the evaluator's `LOW`, `BUY`, or `OUT` assessment; `USE_SOON` follows its three-local-day eligible-stock expiry assessment. An item can have both signals. Only households with attention items appear, ordered by household ID, with items ordered by item ID. No items produces `households: []`. A missing or expired session returns `401`. FE owns display text and should navigate a digest tap to `/attention`, then fetch this endpoint.

## Internal evaluator and intent contract

There is no public evaluator endpoint. `NotificationEvaluatorService.evaluateUser(userId, at, kind?)` and `evaluateEligibleUsers(at, kind?)` are internal entry points. The optional kind lets the disabled-by-default scheduler evaluate `IMMEDIATE_ITEM` periodically and `DAILY_DIGEST` only at the configured local time. Calls without a kind retain the existing manual behavior. All local calendar decisions use `Asia/Ho_Chi_Minh`. The evaluator uses the existing stock-intelligence assessment, including eligible stock and effective expiry. A quantity batch with positive usable stock and effective expiry **today** contributes to `useTodayQuantity`; this includes opened stock whose opening-based use-by is today. Expired stock does not count.

An `IMMEDIATE_ITEM` candidate is created only when an enabled low-stock alert sees a `neverRunOut` item assessed `OUT`, or an enabled expiry alert sees positive `useTodayQuantity`. At most one immediate candidate is made per user, item, and local day; `OUT` takes precedence if both signals occur. A `DAILY_DIGEST` candidate requires `dailyDigestEnabled` and at least one enabled low-stock (`LOW`, `BUY`, or `OUT`) or expiry (`USE_SOON`, within the stock assessment's three-day window) signal. It groups item IDs and signal codes under every currently accessible household ID. Urgent items can also appear in the digest so the aggregate stays complete. The digest subject is user-level, not household-level. Ordinary member activity is passive. Shopping reminders and optional household-event alerts have no reliable trigger in this slice and create no intent.

`NotificationIntent` stores `kind`, `status`, local day, subject key, optional item/household IDs, grouped candidate content, and `dueAt`. A database unique index on `(userId, kind, localDay, subjectKey)` makes retries and concurrent evaluation one-shot. An immediate subject is `householdId:itemId`; the digest subject is `all`, giving at most one digest intent per user/local day. Immediate reappearance later on the same day does not create another intent. Stored content is an assessment snapshot, never permanent permission to send.

Quiet hours use an inclusive start and exclusive end in `Asia/Ho_Chi_Minh`, including ranges across midnight. Evaluation within the range records `DEFERRED` and sets `dueAt` to the next end; otherwise it records `PENDING` due immediately. A future sender must consider both statuses once due and call `revalidateIntent(id, at)`. That method rechecks the current user preference, household memberships, and stock assessment, then returns fresh candidate content only when still eligible and outside quiet hours.

For a digest made during overnight quiet hours (for example, 23:00 to 07:00), revalidating the due, previous-day intent creates or finds **today's** digest intent using fresh current-day assessments and today's existing idempotency key. It returns `{ ready: false, reason: "ROLLED_OVER", replacementIntentId }`; the old intent is never deliverable. The dispatcher revalidates the replacement ID before delivery. Concurrent rollover and ordinary evaluation converge on one current-day digest row through the unique index. If current preferences, stock, or memberships yield no digest, no replacement is made. A previous-day digest that was not an overnight deferred intent remains `STALE_DAY`. A prior-day `USE_TODAY` immediate intent also remains `STALE_DAY`, even if another batch now needs attention; today's evaluator can create a fresh alert. A persistent `OUT` immediate intent may pass only after fresh revalidation of that same signal. An intent alone is not proof of delivery.

## Internal delivery lifecycle and Web Push transport

`NotificationDispatchService.dispatchDue(at, createdAtGte?)` is an internal boundary. There is no HTTP trigger. The disabled-by-default scheduler supplies its activation cutoff; manual callers without one retain the existing behavior. It scans due intents and calls `revalidateIntent` before creating deliveries. A `ROLLED_OVER` digest is replaced by the current-day intent, which is revalidated in the same dispatch; the prior-day intent gets no delivery. A stale condition, removed membership, disabled preference, or quiet hours blocks sending. It checks the session-bound subscription again immediately before calling the transport. Removed, expired, or account-switched sessions are ineligible. Content passed to the transport is the fresh revalidation result, not stored intent content.

For an isolated local-device smoke, use the internal `preflightIntent(userId, intentId, at)` and `dispatchIntentForUser(userId, intentId, at)` boundaries. Preflight returns only `{ eligible, reason, subscriptionCount, destinationKind }`, where destination kind is `ITEM` or `ATTENTION`; it creates no delivery and sends nothing. It requires a current, due, freshly eligible intent belonging to the explicit user and exactly one active subscription across that user's sessions. A prior-day digest is rejected rather than rolled over during dry run. An accepted, failed, claimed, unknown, skipped, or not-yet-due retry delivery is ineligible. The send boundary repeats preflight, selects only that one intent, checks the sole device again before claiming and sending, and uses the same revalidation, claim, and transport behavior as `dispatchDue`. If eligibility changes, it fails closed. Never use `dispatchDue` for a shared local-database device smoke because it scans every due intent.

### Controlled local-device procedure

Replace the angle-bracket placeholders below with the test user's and intent's UUIDs before running commands.

1. Confirm `DATABASE_URL` points to the intended isolated local database and run `npx prisma migrate status` from `apps/api`; do not print credentials. Run `npm run build -w @lumio/api` from the repository root. Use one opted-in test user with exactly one active Push Subscription and a current stock condition. Create a current intent for that user only, if needed, with the following internal one-off command from `apps/api`. It evaluates candidates but sends nothing. Open `npx prisma studio`, filter `NotificationIntent` by that user ID and today's local day, and copy exactly one due intent ID. Do not invoke `dispatchDue`.

   ```powershell
   node --input-type=module -e "import 'reflect-metadata'; import { NestFactory } from '@nestjs/core'; import { AppModule } from './dist/app.module.js'; import { NotificationEvaluatorService } from './dist/notifications/notification-evaluator.service.js'; const app = await NestFactory.createApplicationContext(AppModule, { logger: false }); try { console.log(JSON.stringify(await app.get(NotificationEvaluatorService).evaluateUser(process.argv[1]))); } finally { await app.close(); }" <test-user-id>
   ```

2. From `apps/api`, run `node dist/notifications/manual-push-smoke.js --user-id <test-user-id> --intent-id <intent-id>`. This is the **default dry run**. It prints only the four preflight facts above and exits nonzero if ineligible. Confirm `subscriptionCount` is exactly `1` and `destinationKind` matches the expected tap target. No endpoint, VAPID key, subscription key, or candidate stock snapshot is printed.
3. **Stop for explicit approval before a real send.** After approval for this single user/device/intent, re-run the dry run against the same local target. Only then add `--send` to that exact command. The command invokes `dispatchIntentForUser`, never the due-intent scan. If any condition changes, it fails closed; a completed delivery is not sent again. Verify push-service acceptance, notification display, and tap navigation separately. Do not treat `ACCEPTED` as proof of device receipt.

One `NotificationDelivery` row is unique for `(intentId, SHA-256(subscription endpoint))`. It stores no endpoint or key. `PENDING` is unattempted; an atomic database update claims it as `CLAIMED` and increments `attemptCount`. A successful transport acknowledgement becomes `ACCEPTED` (not proof of user receipt). A definite pre-acceptance `RetryablePushError` becomes `RETRY`, due in five minutes, for at most three attempts, then `FAILED`. A quiet-hours change after claim defers it until quiet hours end. A lost subscription or stale candidate becomes `SKIPPED`. An ambiguous transport error or process interruption leaves `CLAIMED`; a later dispatch classifies claims older than five minutes as `UNKNOWN` and does **not** automatically resend them. The last error code is generic and never includes endpoint, keys, or payload.

Concurrent dispatchers converge on the unique delivery row and atomic claim. Under normal operation they do not call the transport twice for the same intent/device. There is no exactly-once guarantee across a crash after push acceptance but before recording `ACCEPTED`: that row becomes `UNKNOWN` rather than risking an automatic duplicate. FE can integrate preferences, the public key, and subscription registration; it must obtain browser permission itself after a user gesture.

### Server configuration and response classification

Set `VAPID_SUBJECT` to a real `mailto:` contact or public `https:` contact URL, `VAPID_PUBLIC_KEY` to the matching unpadded base64url P-256 public key, and `VAPID_PRIVATE_KEY` to the matching unpadded base64url private key. Supply the private value through server-side secrets or local `.env`; never put it in web assets, API requests, source control, or logs. Create and store the key pair outside this repository. The server validates both key lengths, the P-256 public/private match, and the subject. A missing, partial, or invalid configuration returns `WEB_PUSH_UNAVAILABLE` from the public-key endpoint and makes `dispatchDue` leave all deliveries untouched. Restart the API after changing these variables.

The real transport uses `web-push` with a 10-second request timeout and a 300-second push-service TTL. It passes VAPID details per request rather than setting global library state. Its payload contains only `title`, a generic `body`, and a same-origin relative `url`; it sends no stock counts or subscription secrets. Immediate item alerts link to `/households/:householdId/inventory/:itemId`. Digests link to `/attention`, where FE should fetch the current attention response across households.

A 2xx push-service response marks the delivery `ACCEPTED`, never read. Definite 408, 429, and 5xx responses are retryable. A 404 or 410 marks that delivery `FAILED` and removes only the exact subscription registration that was attempted; another device is unaffected. Other definite 4xx responses mark only that delivery `FAILED` without deleting the subscription. A network error without a response has an unknown acknowledgement and remains `CLAIMED`, later `UNKNOWN`, with no automatic resend. Response bodies, endpoints, and keys are never logged or stored on the delivery record.

Configuring VAPID alone does not start automatic delivery. The scheduler remains off unless explicitly enabled with the configuration below. There is no public dispatch route. The isolated manual Rice device smoke was accepted by the push service and its browser display and tap-through were verified; this does not verify automatic delivery.

## Disabled-by-default automation

`NotificationSchedulerService` starts only from the NestJS HTTP bootstrap after the server begins listening; an application context for the scoped manual smoke command cannot start its timer. It schedules no timer and evaluates or dispatches nothing unless `NOTIFICATION_AUTOMATION_ENABLED=true`. An unset or `false` value stays off even with valid VAPID keys. Any other nonempty value fails startup. Enabling requires both `NOTIFICATION_DIGEST_TIME=HH:mm` (24-hour `Asia/Ho_Chi_Minh`, **no default**) and `NOTIFICATION_ACTIVATION_CUTOFF=YYYY-MM-DDTHH:mm:ss.sssZ` (an explicit UTC activation instant). Missing or invalid values fail startup before a timer is installed. `NOTIFICATION_URGENT_INTERVAL_MINUTES` is an optional technical cadence setting from 1 through 60; it defaults to 5 minutes. The digest time remains a product decision and must be approved before setting it.

The first timer tick occurs one minute after enabled startup; there is no startup catch-up sweep. On each one-minute tick, the scheduler evaluates urgent candidates at the configured cadence, evaluates digest candidates once at or after the configured local time each local day, then dispatches due intents. A periodic urgent evaluation cannot create a digest. A due digest deferred from a prior local day can still roll over at quiet-hours end before today's configured digest time under the already approved rollover rule; it uses fresh current-day stock and today's idempotency key, so the later scheduled evaluation creates no duplicate. A failed evaluation is retried on a later tick. The in-process guard prevents overlapping ticks; across processes, the unique intent key and per-device atomic delivery claim remain the final duplicate protection. A restart can re-evaluate the same day, but the database key prevents another digest intent.

Every automated due scan, rollover replacement, and old-claim classification is restricted to intents with `createdAt >= NOTIFICATION_ACTIVATION_CUTOFF`. The same cutoff must be retained across restarts. Pre-activation pending and deferred intents are never replayed by automation, even if still due. An existing pre-activation intent for today's idempotency key can suppress a fresh same-day alert; the safe default is to wait for the next local day rather than replay it. The scoped manual smoke command is unchanged and does not use this cutoff. Before each delivery, existing revalidation still checks stock, membership, preference, quiet hours, and session; delivery claims, retries, and `UNKNOWN` handling are unchanged.

### Later activation review

1. Obtain product approval for the digest `HH:mm` time. Confirm VAPID configuration, one-user/multiple-household behavior, the active subscription population, and the chosen urgent cadence. Review existing pending intents without deleting or sending them.
2. Record a fresh UTC activation instant as `NOTIFICATION_ACTIVATION_CUTOFF` and use the **same value on every API process and restart**. Review that it is later than the existing intent backlog; otherwise leave automation off. Set `NOTIFICATION_DIGEST_TIME` explicitly and only then set `NOTIFICATION_AUTOMATION_ENABLED=true` in the approved deployment configuration.
3. Obtain explicit approval before restarting any API process with those values. Observe the first minute tick, the scheduled local digest boundary, per-device delivery states, and quiet-hour release using an isolated opted-in account. Keep the automation flag off in the shared local environment until that review. The manual device smoke is not an automatic-scheduler smoke.
