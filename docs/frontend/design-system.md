# Frontend visual foundation

This is an implementation guide for the current web screens, subordinate to the [master product specification](../specs/master-prompt.md). Atomic Design guides how small pieces compose into screens; it does not prescribe folders. The active styles live in `apps/web/src/index.css` and local wrappers in `shared/ui/primitives.tsx`. No shadcn/ui system or production icon library is integrated.

## Tokens and components

| Purpose | Current convention |
| --- | --- |
| Canvas and cards | Ivory `--canvas: #faf9f5`, white `--surface: #ffffff`, sage tint `--surface-soft: #edf2e5` |
| Text and action | Deep ink `--ink: #233c32`, secondary `--muted: #67736c`, sage action `--green: #5b7c5e`, dark green `--green-deep: #395b40` |
| Shape and depth | Cards `--radius: 28px` (25px on mobile), controls 17px, light `--border: #e6e8df`, restrained `--shadow`; section gaps 20–30px |
| Typography | Nunito with rounded/system fallbacks; headings 800–900 weight, body 16px, form controls at least 16px |
| Focus | Visible 3 px `--focus` outline with offset; inputs also gain a green border |

Use `Card` for contained sections, `Button` (primary, secondary, link) for actions, `Notice` for API success/error feedback, and `StockBadge` to label a server-provided status. White text on the primary sage button has approximately 4.68:1 contrast. Existing Shopping controls also use the matching native `.primary`/`.secondary` classes. Buttons, navigation, disclosures, inputs, and selects target at least about 44 px. Keep forms short, labels explicit, and errors beside the affected action.

Status chips show **API-provided** stock health: green `OK`, yellow `LOW`, orange `BUY`, red `OUT`; neutral gray means data is unavailable. Warm colors appear only for these states, Use Soon, purchase priority, or errors. They are not decoration. Do not infer risk, priority, FEFO, or suggestions from client data.

### Illustration assets

The user-provided kawaii SVGs now replace the shared placeholder where a matching illustration exists.

- Item artwork lives in `apps/web/src/shared/assets/illustrations/inventories`; navigation artwork lives in `controls`. The existing `placeholder.svg` remains the fallback.
- `shared/ui/Doodle.tsx` resolves these SVG URLs through Vite. `ItemVisual` selects a matching item illustration from the visible item name, including a small list of English and Vietnamese aliases. This is only a presentation heuristic, not an inventory category or backend field; unknown names use the placeholder.
- Home attention cards, Inventory rows, Item Detail, Shopping items, and Quick Purchase share `ItemVisual` or the same item-name resolver. Home, Inventory, Shopping, and Households navigation use their corresponding controls SVGs.
- Add new artwork under the matching directory and update the alias list only when a filename needs another item name. Do not create icons in component code.
- Import SVG URLs through Vite; never hardcode generated build filenames or local disk paths in screen components. Keep a square viewBox, transparent background, and no embedded text so artwork scales cleanly.
- Decorative images use empty alt text; visible item names and navigation labels carry meaning. Keep status symbols and labels independent of the illustration.
- The supplied SVGs are decorative and do not encode stock health or available actions. Do not draw additional assets until requested.

## Screen hierarchy

- **Home:** follow the approved reference layout: prominent search below the brand, Needs Attention, adjacent green Use and pale sage Restock shortcuts, one Shopping Trip summary card, and bottom navigation. **Keep the attention and quick-action cards in two equal columns even on smartphones.** Show at most two Needs Attention entries in API order; each card contains only the backend status label, matching item illustration or placeholder, item name, and backend stock amount or backup count. Hide the section when empty. Warm alert colors are limited to the supplied attention state. The See all link opens Inventory; individual cards open Item Detail. Use and Restock lead to Inventory for item selection. No stock action or priority calculation runs on Home. Treat reference-image sample counts and product stickers as decorative, not API evidence.
- **Inventory:** follow the mobile reference: a prominent search field, one row of All / Low / Expiring / Opened quick filters, then collapsible location sections with an illustration, name, item count, and compact item cards. Cards show the item name, API-provided amount or current state, and assessment chip. Item cards use matching artwork or the placeholder; location headings use the Inventory control icon. Category, location, tag, exact status, and alternate grouping controls remain under “More filters.” An Add item button follows the list and jumps to the existing form. Grouped quantity amounts come from the API's per-location `quantity`; ungrouped amounts come from household-wide assessment. Suggestions and Use Soon remain API results below the list.
- **Item Detail:** item identity and current stock/state lead. On mobile, quantity Use / Restock disclosures appear immediately after stock, ahead of detailed assessment reasons; forms expand only when needed. Five-level and presence/backup items get mode-specific state buttons and backup addition; Open refill appears only when the assessment recommends it. On desktop, actions occupy the second column. Batch breakdown and activity are in a disclosure below primary actions; Admin stock settings remain collapsed. Show a batch location name only when the detail response supplies one.
- **Auth, households, Shopping:** reuse the ivory canvas, warm surfaces, green actions, type scale, focus ring, and responsive spacing while retaining existing workflows.

Below 700px, grids become single columns and the shared navigation moves to the bottom with safe-area padding. Navigation targets must match current routes in `apps/web/src/app/App.tsx`; this original visual-slice note is not a current route inventory. Main content reserves space for the fixed navigation. Quantity Use / Restock buttons share a row when closed and expand to full width for forms. Treat 390 px as a review width. Touch targets should remain roughly 44 px or more. Inventory uses the queried read response for search, filtering, and location/category groups; named location groups and per-location stock come from the API.


## Adding a screen or component

Follow master prompt section 3 (friendly, calm, mobile-first, low information density) and the user-approved Home / Inventory / Item Detail references. The images guide presentation; they do not establish API support for depicted actions.

1. Reuse tokens, primitives and the shared illustration mapping. Do not introduce another palette, card radius, font family or icon set per feature.
2. Lead with the next useful action and essential stock/state. Put history, batch detail and settings behind native disclosures. Keep labels next to decorative images.
3. Use semantic buttons/links and visible focus. Targets should be at least 44px, with 48px or more for main actions; support reduced motion.
4. Loading, empty and unavailable states must remain distinct from healthy stock. Error messages must not imply a saved mutation. Disabled forms should explain missing prerequisites.
5. Status text is an explicit display mapping (e.g. API `USE_SOON` → “Use soon”). Never derive expiry risk, shopping quantity or priority from dates/counts in CSS or JSX.
6. Check the screen at an actual 390 CSS px and a desktop width, including expanded forms and long names. Browser zoom can make an emulated device width differ from `innerWidth`; record the actual value.

Atomic Design remains a composition guideline: primitives compose into feature sections and pages inside `app/features/shared`. No atoms/molecules folder hierarchy or additional UI dependency is required for this style.

## Integration boundary at the time of the visual refresh (historical)

Home Needs Attention and Inventory search/filter/grouping use the backend read contract. `status=OPENED` is supported for positive opened quantity; the Inventory quick filter uses this API result. The Shopping UI offers all three modes under `SHOPPING_CONTRACT.md`; backup purchases use whole numbers and have no expiry field. Do not copy unsupported controls from the reference images. Undo and PWA have since been implemented in separate slices; consult current source and contracts for their status.
