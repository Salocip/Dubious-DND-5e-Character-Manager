# AGENTS.md

## Agent Instructions

- **Use AFT tools first.** Before `grep`/`read`/shell, use `aft_search` to locate
  code, `aft_outline` for structure, `aft_zoom` to read symbols, `aft_inspect` for
  diagnostics.
- **Specifications live in `docs/`.** D&D 5e rules/spec data is in `docs/book-phb.json`
  (PHB, 5etools schema). Read there before guessing rule content.
- **Alpine.js docs are vendored locally.** The full Alpine.js 3 documentation is
  in `docs/alpine js/` (gitignored, local-only): one `.md` per section —
  `start-here.md`, `upgrade-guide.md`, plus `essentials/`, `directives/`,
  `magics/`, `globals/`, `plugins/`, `advanced/` (each section has a summary
  `.md` at the top level and a folder with the per-page docs). ALWAYS consult
  these docs when in doubt about Alpine.js behavior — directives, magics,
  lifecycle, reactivity — before guessing or asking. For deep source-level
  questions, the Alpine.js source checkout lives at
  `/home/tom/Projects/alpine/` (parser/mutation internals in
  `packages/alpinejs/src/`).

## Project Overview

Single-file D&D 5e character manager. All UI and logic live in `main.html`; the app
has no build step. CDN deps: Tailwind (browser), Alpine.js 3, SortableJS, Fuse.js 7,
deepdash. Dev-only tooling: a static dev server (`live-server`) and a Playwright test
harness (`package.json`, `playwright.config.js`, `tests/`).

## Architecture / Data Flow

- `startup()` fetches `items.json` + `gendata-subclass-lookup.json` from the
  5etools-mirror-3 raw URLs, caches into `localStorage`, builds a Fuse index over
  `equipmentJson.item`.
- Search: `#searchInput` `input` event → Fuse → results in `#equipmentList`; clicking
  a result runs `addItemToInventory()`, moving the row into `#listWithHandle` (Sortable).
- The search `input` listener attaches only AFTER both fetches resolve — search is
  non-functional until data is cached or pre-seeded.

## Data Sources & Schema

- `items.json` — `{ "_meta": { "internalCopies": ["item"] }, "item": [...] }`. Fields:
  `name`, `source`, `rarity`, `type`, `value`, `weight`, `basicRules`, `srd`, `page`,
  `entries`, `miscTags`.
- `gendata-subclass-lookup.json` — 5etools subclass lookup
  (`{ source: { class: { source: { subclass: { name } } } } }`). Fetched remote, cached
  under localStorage key `classesLookupJson`.
- `docs/book-phb.json` — PHB book data (`data[]` of typed sections; `{@...}` markup).
- `localStorage` keys: `equipmentJson`, `classesLookupJson` (both cache-first).
- `items.json`, `classes-lookup.json`, `docs/` are gitignored — never commit them.

## Development

- Run `npm run dev` and open http://localhost:4173/main.html (there is no `index.html`).
- Requires Node 22+.

## Testing

E2E via Playwright (dev-only). Tests live in `tests/`, fixtures in `tests/fixtures/`.
Requires Node 22+.

- Run: `npm test` · `npm run test:ui` · `npm run test:headed`.
- `npm run lint` — ESLint (incl. inline JS via eslint-plugin-html) + html-validate +
  `scripts/lint-custom.mjs` (20 project-specific guards). Report-only; no auto-fix.
  See `scripts/lint-custom.mjs` rule ids for what each guard flags.
- `playwright.config.js` serves the repo at http://localhost:4173 (`python3 -m
  http.server`); the app is at `/main.html` (not `/`).
- Two ways to control the app's data in tests:
  - **Mock the fetch**: `page.route('**/raw.githubusercontent.com/**', ...)` →
    `route.fulfill({ json })`. Tests the startup fetch path.
  - **Pre-seed cache**: seed `equipmentJson`/`classesLookupJson` via
    `storageState.origins` (preferred over `addInitScript`, which throws a
    `SecurityError` on `about:blank`) so `startup()` skips the fetch and the search
    listener attaches synchronously.
- Prefer accessible locators (`getByRole`, `getByText`) over raw selectors.
- CDN libs (Sortable, Fuse) must load for the app to work, so tests need network
  access (or vendored copies — not currently done).

### Visual verification

- Assert an exact style: `expect(locator).toHaveCSS('background-color', 'rgb(255, 0, 0)')`.
- Visual regression: `expect(page).toHaveScreenshot()` (compare against a stored baseline).
- Capture a region to eyeball: `page.screenshot({ clip })`.

### App quirks relevant to tests

- `#selectedSubclasses` is never populated; `classesLookupJson` is unused.
- Search-result `<li>` only renders `name`/`source` correctly; other attributes
  (`rarity`, `type`, `value`, `weight`, …) read the wrong path and show `undefined`.
  Assert on visible text, not attributes.

## Conventions & Constraints

- Edit `main.html` directly; no build step for the app.
- App JS is inline in one `<script>` block (no ES modules); test files use ESM.
- Version control is git only (`.jj/` present but unused).
