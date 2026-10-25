# MASTER PROMPT — HOUSEHOLD INVENTORY & SHOPPING PWA

You are acting as the senior product engineer and technical architect for a new mobile-first household inventory and shopping application.

Your responsibility is not merely to generate code. You must first understand the product logic, translate it into a coherent technical architecture, identify missing technical decisions, and then implement Phase 1 incrementally without unnecessarily expanding the product scope.

The product requirements below are authoritative.

---

# 1. PRODUCT VISION

Build a mobile-first PWA that reduces the mental effort involved in managing household necessities, food, consumables, personal-care products, cleaning supplies, and recurring purchases.

The product is intended primarily for a household of 2 or more people who:

- share household inventory;
- consume items independently;
- shop for groceries and household goods roughly twice per month;
- live far enough from major shopping locations that forgetting essential items is inconvenient;
- want to know what is currently available at home;
- want early warnings for low stock and expiring food;
- want shopping lists to be generated automatically instead of manually checking the house before each trip;
- want inventory maintenance to require minimal manual input.

The central product principle is:

**The user should not feel like they are maintaining a warehouse database. The application should remember, infer, organize, and prompt wherever possible.**

The core loop is:

Stock  
→ Use  
→ Predict  
→ Alert  
→ Plan shopping  
→ Buy  
→ Restock  
→ Stock

---

# 2. PLATFORM AND TECHNICAL DIRECTION

Phase 1 should be implemented as a mobile-first Progressive Web App.

Preferred stack:

Frontend:
- ReactJS
- TypeScript
- PWA support
- responsive/mobile-first design
- TanStack Query is preferred for server-state management unless there is a strong reason otherwise

Backend:
- Node.js
- NestJS
- TypeScript

Database:
- PostgreSQL

ORM:
- Prisma is preferred unless the existing project already uses another appropriate ORM.

Authentication:
- Keep Phase 1 authentication simple.
- Email/password authentication is sufficient.
- Design the authorization layer so that more auth providers could be added later.

Notifications:
- Web Push
- Service Worker
- backend-driven notification scheduling/rules
- notification deep links into relevant screens/actions

Do not make notification action buttons a hard dependency because browser support is inconsistent.

The fallback interaction must always work:

notification → tap → open relevant quick-action screen.

Do not introduce React Native, Expo, Flutter, or native mobile code in Phase 1.

---

# 3. DESIGN PRINCIPLES

The UI must be designed mobile-first.

The application should feel:

- friendly;
- lightweight;
- calm;
- approachable;
- visually simple;
- easy to use with one hand;
- very different from enterprise warehouse/inventory software.

Use:

- clean cards;
- large touch targets;
- clear hierarchy;
- limited information density;
- strong visual state/status indicators;
- minimal cognitive load.

Inventory product illustrations should use a:

**doodle / kawaii / friendly vector illustration style.**

Do NOT create a production icon library yourself yet.

The user will later provide or select an external vector icon set, potentially from services such as Flaticon.

For development, use placeholders or a clean illustration-key abstraction.

Each item should therefore support something like:

`illustrationKey`

Real product photos are NOT required in Phase 1.

---

# 4. PRIMARY NAVIGATION

Design the mobile application around approximately five primary areas:

1. Home
2. Inventory
3. Shopping
4. Meals
5. More / Settings

However:

**Meals is NOT part of the Phase 1 implementation priority.**

It may exist as a placeholder or be omitted from the first implementation depending on architecture.

The priority navigation for Phase 1 is effectively:

Home  
Inventory  
Shopping  
More

---

# 5. HOUSEHOLDS AND USERS

The application supports households containing multiple users.

Each user has their own account.

Every inventory action should be attributable to the user who performed it.

Examples:

- Linh used 2 eggs
- User B opened 1 milk
- Linh restocked detergent

A user belongs to a Household.

Phase 1 supports two roles only:

## ADMIN

Admin can:

- invite/remove household members;
- manage household settings;
- create/edit/delete categories;
- create/edit/delete locations;
- create/edit tags;
- manage stock thresholds;
- modify target stock;
- modify consumption configuration;
- delete inventory items;
- manage general household configuration;
- perform all normal inventory actions.

## MEMBER

Member can:

- view household inventory;
- use inventory;
- open items;
- finish items;
- update stock;
- restock;
- add items;
- add shopping-list items;
- participate in shopping trips;
- modify operational information such as quantity or expiry where appropriate.

Members should NOT normally change configuration that substantially changes shared household logic, such as:

- target stock;
- minimum thresholds;
- household-level categories;
- inventory rules;
- destructive deletion.

Keep the permission model simple in Phase 1.

Do not create additional roles yet.

---

# 6. INVENTORY MODEL — CORE CONCEPT

Do NOT model inventory as a flat list of quantities.

An inventory item represents the logical household product/concept.

Examples:

- Eggs
- Fresh milk
- Beef
- Laundry detergent
- Toothpaste

An item may have:

- one main category;
- one or more household locations depending on its batches;
- multiple tags;
- stock tracking configuration;
- multiple stock batches;
- opened stock;
- stock thresholds;
- target stock;
- shopping preferences;
- usage history.

Suggested conceptual fields include:

- id
- householdId
- name
- description
- mainCategoryId
- illustrationKey
- trackingMode
- primaryUnit
- optional secondaryUnit
- conversion between units where applicable
- minimumStock
- lowStockThreshold
- buyThreshold
- targetStock
- neverRunOut
- consumptionMode
- preferredStore
- createdBy
- createdAt
- updatedAt

Exact schema design is your responsibility, but preserve the domain semantics.

---

# 7. CATEGORIES, LOCATIONS AND TAGS

These are separate dimensions.

Do not treat them as interchangeable.

## CATEGORY

Examples:

- Fresh food
- Pantry / dry food
- Cooking ingredients / condiments
- Drinks
- Frozen food
- Personal hygiene
- Personal care
- Cleaning
- Disposable household goods
- Medicine / basic health supplies
- Household supplies
- Other

An item normally has one primary category.

Subcategories may exist later but are not required to complicate Phase 1.

## LOCATION

Locations represent where something physically exists.

Examples:

- Fridge
- Freezer
- Pantry
- Kitchen cabinet
- Bathroom
- Laundry area
- Bedroom
- Medicine cabinet
- Storage room

Locations should be configurable at household level.

A single item may exist across multiple locations through different stock batches.

Example:

Milk:
- 6 boxes in fridge
- 12 boxes in dry storage

Beef:
- 500 g in fridge
- 1 kg in freezer

## TAGS

Tags are flexible and may be many-to-many.

Examples:

- never-run-out
- refill-regularly
- perishable
- buy-online
- supermarket
- pharmacy
- bulk-buy
- backup-stock

Search and filtering should be able to use category, location, tags, and status independently.

---

# 8. INVENTORY TRACKING MODES

Different products require different stock models.

Do not force every item into one stock mechanism.

Phase 1 should support at least:

## A. QUANTITY MODE

Used when stock can be counted approximately accurately.

Examples:

- eggs;
- milk boxes;
- instant noodle packs;
- canned drinks;
- yogurt;
- meat by weight.

Units can include:

- item;
- box;
- pack;
- bottle;
- can;
- bag;
- piece;
- egg;
- kg;
- g;
- liter;
- ml.

Units should be configurable/extensible.

Example:

Eggs:
- current stock: 8 eggs
- buy threshold: 6
- target stock: 24

The system can therefore suggest purchasing enough to reach the target.

## B. FIVE-LEVEL MODE

Used for liquids or difficult-to-measure consumables.

Use exactly these intuitive levels:

- Full
- ¾
- ½
- ¼
- Empty

Examples:

- laundry detergent;
- shampoo;
- dishwashing liquid;
- cooking oil where exact ml tracking is unnecessary.

Each item may define alert rules based on these levels.

Example:

Laundry detergent:
- current bottle = ¼
- backup = 0
- result = buy soon

But:

- current bottle = ¼
- backup = 2 refills
- result = no urgent shopping need

## C. PRESENCE / BACKUP MODE

For items where the main concern is whether backup stock exists.

Examples:

- spare toothpaste;
- replacement light bulb;
- batteries.

The schema should allow this mode even if Phase 1 UI support is simpler.

---

# 9. STOCK BATCHES

Food and packaged consumables must support stock batches.

Do not create one database row per physical unit if a batch can represent them.

Example:

Fresh milk:

Batch A:
- quantity: 6 boxes
- purchaseDate: 2026-10-01
- expiryDate: 2026-10-15

Batch B:
- quantity: 12 boxes
- purchaseDate: 2026-10-06
- expiryDate: 2026-10-25

Total inventory:

18 boxes

Batch fields may include:

- quantity
- unit
- purchaseDate
- expiryDate
- locationId
- openedQuantity if appropriate
- status
- createdAt

Support batch split/merge conceptually where useful.

---

# 10. OPENED VS UNOPENED STOCK

The application must distinguish opened stock from unopened stock when relevant.

Example:

Milk:

- 5 unopened boxes
- 1 opened box
- opened date = Oct 7
- use by = Oct 9

Support information such as:

- openedAt
- expiryDate
- recommendedDaysAfterOpening

Important dates may include:

- purchase date;
- opened date;
- expiry date;
- use-within-X-days-after-opening;
- freeze date where appropriate.

Not every item needs every date.

The UI should only request relevant dates.

---

# 11. FEFO CONSUMPTION

When an item exists in multiple batches, the application should generally consume stock using:

**First Expire, First Out (FEFO)**

Example:

Eggs:
- 4 expire Oct 10
- 8 expire Oct 20

User taps:

Use 2

The app should automatically reduce the Oct 10 batch first.

The user should not normally have to choose the batch manually.

Manual override may be supported in detail views if needed.

---

# 12. QUICK CONSUMPTION ACTIONS

Daily inventory maintenance must be extremely fast.

The critical rule is:

**Routine consumption should normally require one tap or only a few taps.**

Core actions:

- Use
- Open
- Finish
- Update level
- Restock

Examples:

Eggs:
- -1
- -2
- -4
- Custom

Milk:
- Open 1
- Finish opened
- Use

Laundry detergent:
- Update level
- Open refill

When an opened container becomes empty and backup exists:

Example:

Current detergent:
Empty

Backup:
2

Action:

Open next refill

Result:
- current container becomes Full
- backup becomes 1

Support Undo immediately after fast inventory actions.

---

# 13. HABIT-BASED QUICK PRESETS

Phase 1 does NOT require AI or ML.

However, the UI may prioritize frequently used quantity actions based on simple history.

Example:

If the household frequently consumes 2 eggs:

show:

-2
-1
Custom

rather than arbitrary presets.

This can initially use basic frequency counts.

More advanced behavioral learning is deferred.

---

# 14. CONSUMPTION RATE — PHASE 1 RULE

Do NOT use AI/ML.

For items where usage prediction is enabled:

Use:

**14-day rolling average consumption**

plus approximately:

**20% safety buffer**

Conceptually:

projectedNeed =
rollingDailyConsumption
× daysUntilRelevantShoppingDate
× 1.20

Use configurable thresholds as fallback when there is insufficient history.

Suggested confidence logic:

- fewer than 7 days → low confidence
- 7–21 days → medium
- >21 days → high

Do not overcomplicate this initially.

Each item should eventually support something conceptually similar to:

- fixed threshold only
- learn from usage
- manual expected rate

Phase 1 may implement the first two.

Advanced habit learning should later run in a background worker/job/service rather than being part of the synchronous request flow.

---

# 15. STOCK HEALTH STATUS

Actual quantity and visual alert status are separate concepts.

The application should calculate a simple visual health state.

Use approximately:

- Green = sufficient
- Yellow = getting lower / monitor
- Orange = likely need soon
- Red = should buy
- Empty / dark state = out of stock

The precise mapping may vary by item.

For quantity-based items, consider:

- quantity;
- thresholds;
- consumption rate;
- next shopping date;
- backup inventory.

For five-level items, consider:

- current level;
- backup stock;
- configured thresholds.

---

# 16. HOME SCREEN

Home must use an:

**ACTION-FIRST design.**

Do not make the Home screen a giant inventory dashboard.

Order of priority:

## 1. Needs Attention

Show only important items.

Examples:

Milk:
Use today

Beef:
Expires tomorrow

Detergent:
¼ remaining, no backup

Keep this section small.

Approximately 2–4 high-priority items with a View All option.

If there is nothing important, collapse or hide it.

## 2. Quick Actions

Examples:

- Use
- Restock
- Shopping
- Quick purchase

Meal/Cook can appear later when Meals is implemented.

## 3. Next Shopping Trip Summary

Example:

Next trip:
15 Oct

12 Must buy
5 Should buy

Review trip

Do not show the full shopping list on Home.

## 4. Inventory Snapshot

A lightweight subset of inventory-first information.

Example:

Fridge
18 items
2 alerts

Freezer
12 items

Bathroom
15 items
1 low

## 5. Recent Household Activity

Examples:

Linh used 2 eggs
User B opened milk

This should normally be passive information, not a push notification.

## GLOBAL SEARCH

Place inventory search prominently near the top of Home.

Search is expected to become a major navigation shortcut.

---

# 17. INVENTORY TAB

Inventory should answer:

1. What do we have?
2. Where is it?
3. Is anything wrong?

Mobile structure:

Search

Quick filters:
- All
- Low
- Expiring
- Opened

Additional filters:
- Category
- Location
- Tags
- Stock level
- Expiry range
- Opened/unopened
- Shopping status

Allow grouping by:

- Location
- Category

Default grouping should preferably be:

**Location**

because it matches how users physically inspect the home.

Inventory cards should display only essential information.

Example:

Milk
8 boxes • 1 opened
Nearest expiry: Oct 10
Orange status

Do not display all stock configuration on the list.

Use doodle/kawaii illustrations.

Prefer vertical row cards rather than dense grids.

Swipe actions may be used where appropriate.

---

# 18. ITEM DETAIL SCREEN

The Item Detail screen can expose complexity that is hidden from the Inventory list.

Recommended hierarchy:

## Header

- illustration
- item name
- overall health status
- total current stock
- primary location
- most important warning

Example:

Fresh Milk
8 boxes
Orange
1 opened box should be used today
Fridge

## Contextual Quick Actions

Examples:

- Use
- Open
- Restock
- Edit

Actions depend on tracking mode.

## Stock Breakdown

Opened stock.

Unopened batches.

Example:

Opened:
1 box
Opened Oct 7
Use by Oct 9

Unopened:
Batch A
3 boxes
Expiry Oct 10

Batch B
4 boxes
Expiry Oct 18

## Stock Rules

Collapsed by default.

May include:

- minimum stock
- low threshold
- buy threshold
- target stock
- never run out
- consumption mode

## Location and Tags

## History

Recent events such as:

- used
- opened
- restocked
- moved
- discarded

Only recent history should appear by default.

---

# 19. CHECK LOCATION MODE

Support a fast physical stock-check flow by location.

Example:

Inventory
→ Fridge
→ Check stock

Show items sequentially or as a checklist.

Example:

Milk — 8 ✓
Eggs — 12 ✓
Beef — 800 g ✓
Yogurt — ?
Lettuce — ?

Items with uncertain data should be visually prioritized.

This feature is particularly useful before shopping trips.

---

# 20. ADDING NEW ITEMS

Creating a new item must require minimal initial data.

Suggested flow:

Add new item

Required initially:

- name
- category
- tracking mode
- unit
- starting quantity or level
- location

Optional/conditional:

- expiry date
- purchase date
- target stock
- minimum stock
- tags
- never-run-out
- use-after-opening rule

Do NOT force users to configure every advanced property immediately.

The app should remember item configuration for future purchases.

If the starting stock was entered incorrectly, the user must be able to correct the item's **current stock** afterward without deleting and recreating the item. This applies to quantity, five-level, and presence/backup tracking. Offer a clear correction path from Item Detail; ask for batch or location detail only when it is needed to avoid guessing which physical stock changed. A correction is not a Use or a purchase/Restock. Preserve the original Add Item record and record the correction with actor, time, and before/after stock so the history remains explainable.

Future enhancement:

- barcode scanning;
- camera/photo recognition;
- real product images.

Do not make those Phase 1 requirements unless implementation is trivial and does not delay core functionality.

---

# 21. RESTOCK FLOW — PRIMARY METHOD

The primary restock mechanism is:

**Shopping Trip → purchased items → automatic inventory restock**

Example flow:

Shopping list
→ user checks purchased items
→ user adjusts actual quantity if needed
→ Finish shopping
→ application automatically adds purchased stock
→ application asks only for missing information such as expiry dates

Never ask for information the application already knows.

Examples:

Purchase date:
default to today.

Location:
reuse previous/default location.

Unit:
reuse item configuration.

Quantity:
use actual purchased quantity from shopping mode.

Category:
already known.

Only request missing values.

---

# 22. QUICK PURCHASE

Users may purchase something outside the main planned shopping trip.

Support:

Shopping
→ Quick Purchase

Search existing item
→ enter quantity
→ optional expiry
→ Restock immediately

For a completely new product:

allow Create New Item.

Do not require a full Shopping Trip for ad-hoc purchases.

---

# 23. FUTURE RECEIPT OCR

DO NOT implement as a Phase 1 core dependency.

Keep architecture open for later support of:

**Scan receipt / upload receipt photo**

Potential future extraction:

- product name;
- quantity;
- unit;
- price;
- purchase date.

The system could then match receipt lines with existing inventory items and suggest restock.

Price tracking and spending analytics belong to later phases.

---

# 24. SHOPPING TRIPS

A Shopping Trip is its own domain object.

A typical planned trip is associated with:

**one primary supermarket.**

The user may still make ad-hoc purchases elsewhere using Quick Purchase.

A Shopping Trip has a lifecycle approximately:

Draft
→ Pre-shopping check
→ Finalized
→ Shopping
→ Completed
→ Restocked

Potential fields:

- householdId
- supermarket/store
- plannedDate
- status
- createdBy
- completedAt

---

# 25. SHOPPING LIST GENERATION

The application should generate most of the shopping list automatically.

Sources include:

- out-of-stock items;
- items below buy threshold;
- predicted shortage before the next shopping cycle;
- never-run-out items;
- manually added items;
- items skipped from the previous trip;
- later: missing ingredients from meal planning.

Classify shopping items as:

- Must Buy
- Should Buy
- Optional

Example:

Eggs:
Current = 5
Target = 24

Suggested purchase:
19 eggs

The user must be able to override suggested quantities.

---

# 26. PRE-SHOPPING CHECK

Before a major shopping trip, the application should identify items where stock data is uncertain.

Do not make the user review the entire inventory.

Example:

3 items need checking

Detergent:
App thinks ¼
Choose:
Full / ¾ / ½ / ¼ / Empty

Eggs:
App thinks 6
Adjust:
- / 6 / +

Once confirmed, recalculate the shopping recommendation.

This should take approximately tens of seconds, not minutes.

---

# 27. SHOPPING MODE

When the user taps:

Start Shopping

switch the UI into a simplified checklist.

Do not display analytics or unnecessary metadata.

Example:

WINMART — OCT 15

3 / 17 purchased

MUST BUY

Eggs — 20
Milk — 8 boxes
Beef — 1 kg
Detergent — 1 refill

SHOULD BUY

Yogurt — 6
Tissues — 2 packs

Allow:

- check purchased;
- edit actual quantity;
- Skip;
- Move to next trip;
- add an unplanned purchase.

Group items by supermarket-friendly sections when possible:

- Fresh food
- Meat / seafood
- Dairy
- Pantry
- Drinks
- Household
- Personal care

When shopping ends:

Finish Shopping

Then:

- show purchased count;
- handle unpurchased items;
- restock purchased items;
- request only missing expiry/batch information.

---

# 28. EXPIRY / WASTE ENGINE

Treat:

**low stock**

and:

**expiry risk**

as separate concepts.

Expiry risk should consider:

- expiryDate
- openedAt
- recommendedDaysAfterOpening
- batch status
- current date

Support a:

**Use Soon**

concept.

Example Home section:

Use Soon

Milk
opened
use today

Beef
expires tomorrow

Vegetables
purchased several days ago

Do not over-engineer shelf-life inference for items without explicit expiry during Phase 1.

---

# 29. LOW-STOCK ENGINE

Evaluate low-stock risk using combinations of:

- current quantity;
- current five-level status;
- backup stock;
- fixed thresholds;
- consumption rate;
- time until next expected shopping trip;
- safety buffer.

Do not treat a fixed quantity threshold as the only signal.

Example:

8 eggs may seem adequate.

But if:
- average consumption = 2/day
- next shopping trip = 6 days away

then 8 eggs are insufficient.

---

# 30. NOTIFICATIONS

Use three conceptual levels:

## Immediate

Only for genuinely important events.

Examples:

- opened milk should be used today;
- essential never-run-out item is out;
- food is expiring imminently.

## Daily Digest

One consolidated notification.

Example:

3 items running low
2 items should be used soon

## Passive

Visible in the app only.

Examples:

stock slowly declining.

Avoid notification spam.

The user should not be notified every time another household member uses something.

---

# 31. WEB PUSH

Use PWA Web Push.

Backend should evaluate notification conditions.

Do not rely on the PWA remaining active in the background.

Use NestJS jobs/scheduling where appropriate.

Conceptually:

scheduled backend process
→ evaluate inventory
→ determine alerts
→ send Web Push

Store push subscriptions per user/device.

Each user may have multiple devices.

Notification preference should be user-specific.

---

# 32. DEEP LINK NOTIFICATIONS

Notifications should be actionable even when notification-button actions are unsupported.

Example:

Milk expires today

Tap

→ open directly to Milk quick action

Possible actions:

- Used
- Discarded
- Remind tomorrow

Do NOT:

notification
→ Home
→ make user search for milk manually.

Notification action buttons may be implemented as progressive enhancement where browser support permits.

---

# 33. SETTINGS

Settings should be separated conceptually into:

## Household Settings

- household name
- members
- default shopping cycle
- default supermarket
- household locations
- categories
- tags

## Inventory Defaults

- units
- default tracking mode by category
- default low thresholds
- default buy thresholds
- target stock defaults
- default safety buffer
- default expiry reminders

## Notification Preferences — per user

- expiry alerts
- low-stock alerts
- shopping-trip reminders
- daily digest
- optional household events
- quiet hours

## Permissions

Admin / Member only in Phase 1.

---

# 34. ACTIVITY LOG

Record meaningful inventory changes.

Examples:

- USER_USED_ITEM
- USER_OPENED_ITEM
- USER_FINISHED_ITEM
- USER_RESTOCKED_ITEM
- USER_UPDATED_LEVEL
- USER_DISCARDED_ITEM
- USER_MOVED_ITEM
- SHOPPING_TRIP_COMPLETED

Activity records should capture:

- household
- user
- item
- timestamp
- action
- quantity delta where relevant
- contextual metadata if necessary

Use activity history for:

- audit;
- recent household activity;
- consumption-rate calculations;
- later habit-learning.

---

# 35. MEALS / RECIPES — DEFERRED FEATURE

DO NOT prioritize this for the initial Phase 1 implementation.

However, design the architecture so it can later support:

- saved recipes;
- frequently cooked dishes;
- ingredients and quantities;
- serving count;
- ingredient scaling by serving;
- cooking a recipe automatically deducts ingredients;
- FEFO when deducting ingredient inventory;
- missing ingredients → Add to Shopping List;
- 1–2 week meal planning;
- meal plans contribute projected ingredient demand to shopping calculations.

Do not build this feature unless explicitly asked in a later step.

---

# 36. VOICE / STT — DEFERRED

Do NOT implement Speech-to-Text in Phase 1.

Future usage examples:

“Used 2 eggs and 300 grams of beef.”

The system could later parse this into inventory events.

This requires:

- STT
- intent parsing
- entity extraction

Therefore it should be a later-phase enhancement.

Do not make current inventory UX dependent on voice.

---

# 37. BARCODE / CAMERA — LATER

Barcode scanning and camera-based product recognition may be useful later.

Possible future uses:

- identify packaged products;
- pre-fill name/brand;
- scan expiry dates;
- recognize product packaging.

Do not allow these features to delay the core product.

---

# 38. PRICE / SPENDING — LATER

Explicitly out of initial scope:

- historical prices;
- monthly spending analytics;
- price comparison;
- supermarket price comparison;
- trip budgets;
- category spending.

Design schemas in a way that does not make future extensions impossible, but do not implement speculative complexity.

---

# 39. ADVANCED HABIT LEARNING — LATER

Do NOT implement AI/ML habit learning in Phase 1.

Future architecture may use:

- NestJS background job;
- job queue;
- worker process;
- separate service.

This future process may periodically compute:

- item usage profiles;
- household habits;
- seasonality;
- better recommended quantities;
- better quick-action presets.

For now use deterministic rules and simple statistics.

---

# 40. USER EXPERIENCE PRINCIPLES

These rules are important.

## DO NOT ASK TWICE

If data is already known from:

- shopping list;
- item config;
- previous purchase;
- current context;
- household config;

do not ask for it again.

## MINIMIZE FORMS

Daily usage should be actions, not forms.

## SMART DEFAULTS

Use previous/default:

- location;
- unit;
- category;
- quantity preset;
- purchase date;
- store.

## PROGRESSIVE DISCLOSURE

Inventory list:
simple.

Item detail:
more information.

Advanced settings:
collapsed.

## SHOW ONLY WHAT NEEDS ATTENTION

Avoid dashboards full of metrics.

## MOBILE FIRST

Prioritize thumb-friendly actions and readable cards.

---

# 41. PHASE 1 IMPLEMENTATION SCOPE

The first usable release should include:

1. React PWA shell
2. NestJS API
3. PostgreSQL database
4. Prisma schema/migrations
5. Authentication
6. Household creation
7. Household membership
8. Admin/Member authorization
9. Categories
10. Locations
11. Tags
12. Inventory items
13. Quantity tracking
14. Five-level tracking
15. Batches
16. Opened/unopened state
17. Relevant dates
18. FEFO
19. Inventory list
20. Search
21. Filters
22. Group by location/category
23. Item detail
24. Quick consumption actions
25. Undo for recent quick actions where feasible
26. Restock
27. Quick purchase
28. Activity history
29. Basic low-stock engine
30. Basic expiry engine
31. 14-day consumption rolling average
32. 20% consumption safety buffer
33. Home action-first dashboard
34. Shopping Trips
35. Auto-generated shopping suggestions
36. Must / Should / Optional
37. Pre-shopping stock check
38. Shopping mode
39. Actual purchased quantity
40. Finish shopping → automatic restock
41. Notification preference model
42. Web Push infrastructure
43. Deep links into relevant item/action
44. Basic settings
45. Mobile-first responsive UI
46. Placeholder illustration-key architecture

---

# 42. EXPLICITLY OUT OF PHASE 1

Do not implement unless specifically requested later:

- Meals/Recipes
- meal planning
- Speech-to-Text
- receipt OCR
- advanced barcode database integration
- camera product recognition
- real product photographs
- advanced AI/ML
- advanced habit-learning worker
- price tracking
- spending analytics
- budget management
- multi-store trip optimization
- native mobile applications
- complex roles beyond Admin/Member

---

# 43. DEVELOPMENT APPROACH

Before coding:

1. Inspect the existing repository if one exists.
2. Do not overwrite working architecture without reason.
3. Identify what is already implemented.
4. Produce a short technical implementation plan.
5. Identify major domain entities.
6. Propose the database schema.
7. Propose API boundaries.
8. Propose frontend route/screen structure.
9. Identify which Phase 1 features should be implemented first.

Then proceed incrementally.

Suggested implementation order:

### Foundation
- monorepo/project structure if needed
- database
- auth
- household
- roles

### Inventory Core
- categories
- locations
- tags
- items
- batches
- tracking modes
- actions
- activity log

### Inventory UI
- mobile navigation
- Home skeleton
- Inventory
- Item Detail
- search/filter

### Shopping
- shopping-trip domain
- suggestion engine
- pre-check
- shopping mode
- finish/restock

### Intelligence
- expiry engine
- threshold engine
- consumption rolling average
- stock status

### Notifications
- push subscriptions
- scheduler
- notification preferences
- deep links

### Polish
- error states
- loading states
- empty states
- mobile UX
- accessibility
- tests

---

# 44. CODE QUALITY EXPECTATIONS

Use:

- TypeScript strictness;
- domain-oriented naming;
- reusable validation;
- DTO validation in NestJS;
- database transactions for inventory-changing operations where appropriate;
- authorization checks at backend boundaries;
- predictable API error responses;
- migrations;
- seed data for development;
- clean separation between business logic and HTTP controllers.

Avoid putting complex domain logic directly inside controllers.

Create services/domain modules for logic such as:

- FEFO consumption;
- stock-health calculation;
- shopping recommendation;
- consumption-rate calculation;
- expiry status;
- restocking.

---

# 45. INVENTORY CONSISTENCY

Inventory mutation is sensitive.

Whenever possible, inventory-changing actions should be represented as events or transactions.

Example:

Consume 2 eggs

should conceptually produce:

InventoryAction:
- type = USE
- itemId
- userId
- quantity = 2

Then apply FEFO to batches.

This helps support:

- history;
- undo;
- consumption statistics;
- debugging.

Do not rely solely on directly modifying a single quantity field without preserving an audit trail.

An entered stock value may be wrong. Correct the **current** batch/state data and append an attributable correction; do not rewrite the original stock action or fabricate consumption/purchase history. A correction must not inflate the usage rate used for shopping prediction. For items with multiple batches or locations, preserve their physical meaning rather than silently reallocating a total.

---

# 46. CONCURRENCY

Multiple household users may update the same inventory.

Avoid obvious race conditions.

Example:

Two users simultaneously consume eggs.

Use:

- database transactions;
- safe updates;
- server as source of truth.

Do not rely on client-side inventory state as authoritative.

---

# 47. OFFLINE / PWA EXPECTATIONS

Phase 1 should be installable as a PWA.

At minimum:

- manifest;
- icons/placeholders;
- service worker;
- sensible offline shell behavior.

Full offline inventory mutation synchronization is NOT mandatory unless it can be implemented without substantial complexity.

If offline mutation sync is not implemented, provide graceful messaging.

Do not silently lose user actions.

---

# 48. TESTING PRIORITIES

Prioritize tests for business rules rather than only UI snapshots.

Important cases:

- FEFO consumes the correct batch;
- opened item state updates correctly;
- five-level stock transitions correctly;
- backup stock affects low-stock status;
- target stock produces correct shopping quantity;
- rolling consumption rate is calculated correctly;
- insufficient history falls back to thresholds;
- expiry alerts respect openedAt/use-after-opening;
- role permissions are enforced;
- shopping completion creates the correct restock batches;
- concurrent stock changes do not produce invalid negative quantities.

---

# 49. SEED / DEMO DATA

Create development seed data that demonstrates the product clearly.

Suggested household:

2 users.

Items:

Eggs:
- quantity mode
- 12 eggs
- two batches

Milk:
- quantity mode
- 8 boxes
- one opened
- multiple expiry dates

Beef:
- weight
- fridge/freezer batches

Laundry detergent:
- five-level
- ¼ remaining
- zero backup

Toothpaste:
- backup/presence stock

Tissues:
- quantity mode

This should make Home, Inventory, Shopping, and alerts visibly testable.

---

# 50. FINAL PRODUCT PRINCIPLE

When making implementation decisions, prioritize:

**less user effort over more data precision**

unless precision materially affects the usefulness of the product.

The application should be:

- quick;
- forgiving;
- explainable;
- predictable;
- easy to maintain;
- easy to extend later.

Do not turn it into ERP software.

---

# YOUR FIRST TASK

Do NOT immediately implement the entire application.

First:

1. inspect the current repository/environment;
2. summarize what already exists;
3. propose the Phase 1 architecture;
4. propose the database/domain model;
5. propose the frontend route/component structure;
6. propose the backend module structure;
7. identify implementation milestones;
8. identify any genuine blockers.

Do not ask questions about minor design details that can reasonably use defaults.

Only ask a question if the missing information would materially change the architecture or cause significant rework.

Otherwise make a reasonable assumption, document it, and continue.

After presenting the implementation plan, begin with the technical foundation and proceed incrementally.

At the end of each meaningful milestone:

- state what was implemented;
- state what remains;
- mention any deviations from this specification;
- run appropriate tests/lint/type checks;
- do not claim functionality works unless verified.

The Phase 1 implementation must remain aligned with this product specification.
