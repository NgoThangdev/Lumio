## In Phase 1

### Foundation and household access

- Provide a React and TypeScript Progressive Web App shell, a NestJS and TypeScript API, a PostgreSQL database, and a Prisma schema, database access, and migrations.
- Support simple email/password authentication, household creation, and household membership. Each user has an account and belongs to a household.
- Enforce the two Phase 1 roles, Admin and Member. Admins manage household configuration, categories, locations, tags, stock rules, and destructive item changes. Members can view and perform normal inventory and shopping actions and update appropriate operational details. Attribute inventory actions to the user who performed them.

### Inventory catalog and stock

- Keep categories, locations, tags, inventory items, and stock batches distinct. An inventory item is the logical household product, normally with one primary category. Locations describe where its batches physically exist; one item may have stock in multiple locations. Tags are flexible and may be multiple per item.
- Support quantity tracking with configurable or extensible units, and five-level tracking using exactly Full, ¾, ½, ¼, and Empty. Allow presence/backup mode in the stock model, with simpler Phase 1 UI support.
- Support stock batches for food and packaged consumables, including their quantities, relevant dates, and locations. Distinguish opened from unopened stock when relevant. Request only dates relevant to the item, such as purchase, opening, expiry, use-after-opening, or freeze dates.
- Apply First Expire, First Out (FEFO) by default when consuming stock from multiple batches, without normally requiring the user to select a batch.
- Make adding an item require minimal initial information: name, category, tracking mode, unit, starting quantity or level, and location. Keep advanced properties conditional or optional and remember item configuration for future purchases.

### Inventory views and actions

- Provide an inventory list with essential stock and status information, search, and independent filters for category, location, tags, and status. Include quick filters for All, Low, Expiring, and Opened, plus relevant stock, expiry, and shopping filters.
- Allow inventory grouping by location or category, preferably defaulting to location.
- Provide an item detail view with stock health, total stock, contextual actions, opened stock and batch breakdown, locations and tags, recent history, and stock rules disclosed as needed.
- Provide fast, tracking-mode-appropriate actions such as Use, Open, Finish, Update level, and Restock. Support immediate Undo for recent quick actions where feasible. When an opened container is empty and backup exists, allow opening the next refill and updating backup stock.
- Let a household member correct wrongly entered current stock from Item Detail, including after Add Item, for quantity, five-level, and presence/backup items. Keep the original action and record an attributable before/after correction instead of representing it as Use or Restock. Request location or batch detail only when needed for an unambiguous correction.
- Support a quick physical stock check by location, prioritizing items with uncertain stock data.
- Record meaningful inventory and shopping activity with household, user, item where applicable, time, action, and relevant quantity changes. Use the history for recent activity and consumption calculations.

### Stock health and Home

- Calculate basic low-stock health separately from actual quantity. Consider quantity or five-level status, backup stock, configured thresholds, consumption rate, time until the next expected shopping trip, and the safety buffer.
- Calculate basic expiry risk separately from low stock, considering relevant batch expiry, opening and use-after-opening information. Surface items that should be used soon.
- For items with usage prediction enabled, use a 14-day rolling average consumption rate and an approximately 20% safety buffer to estimate need through the relevant shopping date. Fall back to configurable thresholds when history is insufficient; do not require AI or machine learning.
- Make Home action-first: show a small set of important Needs Attention items, quick actions, a next-trip summary, a lightweight inventory snapshot, and passive recent household activity. Place inventory search prominently near the top. Do not turn Home into a full inventory dashboard.

### Shopping and restocking

- Support Shopping Trips as distinct from ad-hoc purchases. A typical planned trip has one primary supermarket and progresses through draft, pre-shopping check, finalized, shopping, completed, and restocked states.
- Generate most shopping suggestions from out-of-stock items, buy thresholds, predicted shortages before the next shopping cycle, never-run-out items, manually added items, and items skipped from a previous trip. Suggest quantities toward target stock while allowing user overrides.
- Classify shopping entries as Must Buy, Should Buy, or Optional.
- Before a major trip, prompt a short stock check only for uncertain items, then recalculate recommendations from the confirmed stock.
- Provide a simplified shopping checklist. Let users mark purchases, enter actual purchased quantities, skip or move items to a later trip, and add unplanned purchases. Group by supermarket-friendly sections when possible.
- On Finish Shopping, show the purchased count, handle unpurchased items, and automatically restock purchased items using actual quantities. Reuse known item, unit, location, category, store, and purchase information; request only missing batch or expiry details.
- Support Quick Purchase outside a planned trip: find an existing item, enter quantity and optional expiry, and restock immediately; allow creation of a new item when needed. Also support direct restock actions.

### Notifications and settings

- Provide a per-user notification preference model for expiry alerts, low-stock alerts, shopping reminders, daily digest, optional household events, and quiet hours.
- Provide PWA Web Push infrastructure with backend evaluation and scheduling of alerts and subscriptions per user and device. Use immediate notifications for important events, a consolidated daily digest, and passive in-app information where appropriate; avoid routine household-activity notification spam.
- Make a notification tap open the relevant item or quick action directly. Notification action buttons may be a progressive enhancement, but the tap-to-action path must work without them.
- Provide basic settings for household details and members, shopping defaults, household categories, locations and tags, inventory defaults and stock rules, notification preferences, and Admin/Member permissions.

### Mobile presentation

- Make the UI responsive and mobile-first, with readable cards, clear status indicators, large touch targets, and short routine flows. Prioritize Home, Inventory, Shopping, and More/Settings navigation.
- Make the PWA installable with a manifest, placeholder icons, a service worker, and sensible offline shell behavior. If offline inventory changes are unavailable, show clear messaging rather than silently losing actions.
- Support a placeholder illustration-key approach for inventory items and friendly illustration placeholders. A production icon library and real product photos are not required.

## Out of Phase 1

### Meals & Meal Planning
- Meals / Recipes
- Meal planning
- Saved recipes
- Ingredient-based meal planning
- Serving scaling
- Cooking-based automatic inventory deduction
- Meal planning integration with shopping

### Voice & Camera
- Voice / Speech-to-Text (STT)
- Barcode scanning / advanced barcode database
- Camera-based product recognition
- Real product photos

### Shopping & Purchase Intelligence
- Receipt OCR
- Price tracking
- Spending analytics
- Budget management
- Multi-store optimization

### AI & Advanced Learning
- Advanced AI / ML features
- Advanced habit learning
- Background habit-learning worker

### Mobile & Additional Capabilities
- Native mobile applications
- React Native / Expo / Flutter
- Additional / complex user roles beyond the Phase 1 role model
