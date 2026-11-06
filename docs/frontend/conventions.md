# Lumio frontend conventions

These are Lumio maintenance choices for `apps/web`, not universal React rules or product requirements. Product behavior comes from the [master specification](../specs/master-prompt.md) and Phase 1 scope; check current API contracts and source before changing a flow. See the [architecture map](architecture.md) and [visual foundation](design-system.md).

## Names and boundaries

- Use `PascalCase` for React components and their files, `useSomething` for custom hooks, and descriptive `camelCase` for pure functions and values. Name booleans as questions (`isPending`, `canEdit`). Keep API enum values intact.
- Prefer named exports for components and helpers. Use a default export where a tool requires one, such as Vite configuration. Export only what another file needs; avoid catch-all barrels that hide ownership.
- `app` owns routing, session and household guards, and shell composition. `features/<feature>` owns its screens, forms, and feature-only helpers. `shared` holds code with actual cross-feature use: API transport/types/keys, i18n, and reusable UI. Imports should flow from `app` to features/shared and from features to shared; shared must not depend on a feature. Avoid feature-to-feature imports when a true shared contract or component is needed.
- Use relative imports within one feature and `@/` for imports crossing `app`, `features`, or `shared`. Existing relative cross-boundary imports can move when their files are touched; do not rewrite the repository solely for style. TypeScript and Vite both map `@/` to `apps/web/src`.
- Keep a small component or helper near its only consumer. Extract sections by screen responsibility when a page becomes hard to scan. Put a custom hook beside the feature when it coordinates reusable React state or effects; keep deterministic formatting and mapping in pure functions. Put API response types in `shared/api/types` when genuinely shared. Do not create empty folder layers or a second state store for a convention.

## React and state

- Follow the [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks): call Hooks at the top level of components or custom Hooks. Keep rendering [pure](https://react.dev/learn/keeping-components-pure); event handlers and mutation callbacks perform side effects. Use [Effects](https://react.dev/learn/synchronizing-with-effects) to synchronize with external systems when needed, rather than to derive render data. Review existing Shopping/Settings Effect warnings during their own scoped work; this guide does not waive them.
- Keep temporary input and disclosure state local. Put shareable filters, selected IDs, and direct-link context in the URL when reload/back must preserve them. TanStack Query owns server reads. Use `shared/api/keys.ts` with user, household, item, trip, and query parameters as applicable; clear account data at session boundaries.
- After a successful mutation, invalidate/refetch every affected read, including Item Detail, Inventory, Home, Shopping, and assessments as the operation requires. Await and distinguish a saved mutation followed by failed refresh from a rejected mutation. Never automatically retry a stock mutation after a timeout or uncertain network outcome; retain the draft and direct the user to current stock and activity before an explicit retry.
- The backend owns stock totals, FEFO, eligibility, assessment, priority, predictions, suggestions, revisions, transaction rules, and authorization. The frontend presents returned values and submits user intent. Role-based UI gates improve clarity but do not replace API authorization.

## Text, styles, access, and security

- Add user-facing copy to matching bundled EN/VI locale JSON namespaces. Keep semantic keys and matching interpolation placeholders. Run `npm run i18n:check -w @lumio/web` and `format:check`; use shared date/number formatting and preserve the business timezone. Translate known enum and error codes without changing unknown server meaning. Keep user-created names and primary units as returned.
- Use existing semantic tokens, themes, and shared primitives in `src/index.css` and `shared/ui`. Keep feature-specific styles with the owning feature when extraction is justified, and verify cascade and mobile/light/dark behavior. Do not add a parallel palette or component system for one screen.
- Use semantic landmarks, headings, labels, text action names, visible focus, and touch-sized controls. Check keyboard use, loading/empty/error feedback, 320/390 px reflow, and both languages when UI moves. Decorative doodles must not carry status alone.
- Use the shared same-origin API client with cookie sessions. Do not store credentials, session secrets, invite secrets, or push subscription keys in local state persistence or logs. Do not embed untrusted API/user strings as HTML. Keep household access behind route guards and backend checks; never treat a hidden button as permission enforcement. Do not cache authenticated API responses in the service worker or queue offline stock writes.

## Verification decisions

For a scoped change, inspect the shared worktree, run build, lint, `format:check`, `i18n:check` when locale files change, and `git diff --check`; browser-check affected flows and report unobserved states. The web workspace currently has no FE test framework or test script, and this guide does not choose one. Automated FE tests and a CI provider remain separate decisions based on the next useful coverage and deployment needs.
