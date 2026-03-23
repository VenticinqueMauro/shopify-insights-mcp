# Phase 3: Tests & Code Quality - Research

**Researched:** 2026-03-23
**Domain:** Vitest unit testing for TypeScript ESM Node.js MCP server; dead code removal
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | Vitest is configured and `npm test` runs the suite | Vitest 4.1.1 install + vitest.config.ts pattern documented below |
| TEST-02 | Unit tests cover `src/analytics/comparisons.ts` (delta/percentage math) | `calculateChange` signature and edge cases documented below |
| TEST-03 | Unit tests cover `src/utils/dates.ts` (date range construction, timezone handling) | All exported functions and their contracts documented below |
| TEST-04 | Unit tests cover `src/utils/formatting.ts` (currency, percentage, edge cases including -0) | Exact bug location and fix pattern documented below |
| TEST-05 | Unit tests cover `src/analytics/recommendations.ts` (structured signal → recommendation mapping) | `generateSalesRecommendations` signal matrix documented below |
| QUAL-01 | Setup wizard does not prompt for OAuth Client ID / Client Secret (dead code removed) | Exact lines 78–79 in `src/cli/index.ts` identified; lines 97–98 also conditional |
| QUAL-02 | Dev/seed utility scripts confirmed untracked by git | Already gitignored — NOT in `git ls-files`; success criterion already met |
| QUAL-03 | `formatPercentage` and `formatCurrencyChange` handle `-0` correctly | Bug is `value > 0` sign guard — exact fix pattern documented below |
</phase_requirements>

---

## Summary

Phase 3 installs Vitest into an existing TypeScript ESM project (no Vite, `"type": "module"`, `module: Node16`), writes unit tests for the four pure-logic modules, and removes two categories of dead code: OAuth credential prompts in the CLI wizard and dev seed scripts from git tracking.

The test targets are all pure functions with no I/O — `calculateChange`, `getPeriodDates`, `getPreviousPeriodDates`, `formatCurrency`, `formatPercentage`, `formatCurrencyChange`, and `generateSalesRecommendations`. No mocking is needed. The only stateful concern is `resetShopContextCache()` in `src/shopify/shop.ts`, which exists for test isolation but does not need to be tested directly.

The biggest gotcha is vitest's module resolver vs. Node16 `.js` import extension requirement. The project's source files use `.js` import extensions (e.g., `from './comparisons.js'`), but vitest resolves `.ts` files. This is resolved by setting `resolve.extensions` in `vitest.config.ts` so vitest maps `.js` specifiers to the actual `.ts` files.

**Primary recommendation:** Install vitest 4.1.1 with a `vitest.config.ts` that sets `resolve.extensions`, write tests directly in `src/__tests__/`, add `"test": "vitest run"` to package.json scripts.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.1.1 | Test runner + assertions | No-config for TypeScript, fastest for Node-only projects, Vite-family |
| @vitest/coverage-v8 | 4.1.1 | Coverage reports via V8 | Same version as vitest, zero extra config |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none required) | — | — | No DOM, no mocks, no external I/O in test targets |

**Installation:**
```bash
cd shopify-insights-mcp
npm install -D vitest@4.1.1 @vitest/coverage-v8@4.1.1
```

**Version verification:** Confirmed via `npm view vitest version` → `4.1.1` (2026-03-23).

---

## Architecture Patterns

### Recommended Project Structure
```
shopify-insights-mcp/
├── src/
│   ├── __tests__/
│   │   ├── comparisons.test.ts
│   │   ├── dates.test.ts
│   │   ├── formatting.test.ts
│   │   └── recommendations.test.ts
│   ├── analytics/
│   │   ├── comparisons.ts
│   │   ├── insights.ts
│   │   └── recommendations.ts
│   └── utils/
│       ├── dates.ts
│       └── formatting.ts
├── vitest.config.ts          ← new
└── package.json              ← add "test" script
```

### Pattern 1: vitest.config.ts for TypeScript Node16 ESM
**What:** `resolve.extensions` maps `.js` import specifiers to `.ts` source files, which is required because Node16 TypeScript source uses `.js` extensions in imports but vitest resolves `.ts` files.
**When to use:** Any TypeScript project with `"module": "Node16"` and `"type": "module"` that imports with `.js` extensions.

```typescript
// vitest.config.ts — place in shopify-insights-mcp/
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

The `tsconfig.json` uses `"module": "Node16"` — this config does NOT change tsconfig. Tests use explicit `import { ... } from 'vitest'` (globals: false) for clarity.

### Pattern 2: Test file structure
```typescript
// src/__tests__/comparisons.test.ts
import { describe, it, expect } from 'vitest';
import { calculateChange } from '../analytics/comparisons.js';

describe('calculateChange', () => {
  it('returns flat when previous is 0 and current is 0', () => {
    expect(calculateChange(0, 0)).toEqual({ value: 0, percentage: 0, direction: 'flat' });
  });
  // ...
});
```

Note: imports still use `.js` extension (matches source), vitest resolves them to `.ts` via `resolve.extensions`.

### Anti-Patterns to Avoid
- **Using `globals: true` without justification:** Pollutes scope; explicit imports are clearer for a small test suite.
- **Separate `tsconfig.test.json` with `"module": "bundler"`:** Over-engineering; `resolve.extensions` in vitest.config.ts is sufficient.
- **Placing tests in a top-level `tests/` directory:** The project has no prior convention; `src/__tests__/` keeps tests adjacent to source and is vitest's idiomatic default.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| -0 detection | Custom `isNegativeZero()` | `Object.is(value, -0)` | Built-in JavaScript, handles IEEE-754 edge case correctly |
| Test assertions | Manual `if` + `throw` | vitest `expect()` | Diff output, type narrowing, standard API |

---

## Exact Function Signatures to Test

### `src/analytics/comparisons.ts` — `calculateChange`
```typescript
export function calculateChange(current: number, previous: number): ChangeResult
// ChangeResult = { value: number; percentage: number; direction: 'up' | 'down' | 'flat' }
```

**Test matrix:**
| Scenario | current | previous | expected direction | expected percentage |
|----------|---------|----------|-------------------|---------------------|
| Up | 110 | 100 | `'up'` | 10 |
| Down | 90 | 100 | `'down'` | -10 |
| Flat (within ±0.05%) | 100.01 | 100 | `'flat'` | ~0.01 |
| Previous=0, current>0 | 50 | 0 | `'up'` | 100 |
| Previous=0, current=0 | 0 | 0 | `'flat'` | 0 |
| Value field = current - previous | 110 | 100 | — | value=10 |

**Threshold:** `percentage > 0.05 → 'up'`, `< -0.05 → 'down'`, else `'flat'`. Test the boundary.

---

### `src/utils/dates.ts` — Exported functions
```typescript
export function getPeriodDates(
  period: Period,
  startDate?: string,
  endDate?: string,
  timezone?: string  // default 'UTC'
): { start: Date; end: Date }

export function getPreviousPeriodDates(start: Date, end: Date): { start: Date; end: Date }
export function formatDateForShopify(date: Date): string
export function buildShopifyDateQuery(start: Date, end: Date): string
export function formatPeriodLabel(period: Period, start: Date, end: Date): string
export function formatPreviousPeriodLabel(period: Period, start: Date, end: Date): string
```

**Test matrix:**
| Function | Key cases |
|----------|-----------|
| `getPeriodDates('custom', ...)` | Returns correct start/end; throws for invalid dates; throws if start > end |
| `getPeriodDates` (non-custom) | `today`, `week`, `month` all return `end.getHours() === 23` |
| `getPreviousPeriodDates` | Previous end = start - 1ms; duration preserved |
| `formatDateForShopify` | Returns ISO string |
| `buildShopifyDateQuery` | String contains `processed_at:>=YYYY-MM-DD processed_at:<=YYYY-MM-DD` |

Note: `today`, `yesterday`, `week`, `month` all call `new Date()` internally — tests can verify structural properties (e.g., end time is 23:59:59.999) without pinning to a fixed date.

---

### `src/utils/formatting.ts` — The `formatPercentage` Bug

**Current code (line 10–13):**
```typescript
export function formatPercentage(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}
```

**The bug:** `formatPercentage(0)` produces `"0.0%"` (correct, no sign), but the success criterion says `"0%"` — meaning the test enforces no decimal for zero. More importantly, `formatPercentage(-0)` produces `"0.0%"` via `value.toFixed(1)` which converts `-0` to `"0.0"` — the sign guard `value > 0` is false for `-0`, so no `+` prefix, which is correct. But `(-0).toFixed(1)` === `"0.0"` in JS — no negative sign. This is fine behavior.

**The real edge case to fix (QUAL-03):** `formatCurrencyChange` has the same pattern:
```typescript
export function formatCurrencyChange(amount: number, currency: string = 'USD'): string {
  const sign = amount > 0 ? '+' : '';
  return `${sign}${formatCurrency(amount, currency)}`;
}
```
`formatCurrencyChange(-0)` → `formatCurrency(-0, 'USD')` → `Intl.NumberFormat` formats `-0` as `"$0.00"` in most engines, no negative sign. The sign guard also gives `''` since `-0 > 0` is false. Result: `"$0.00"` — no `+$0.00` artifact. This is already correct behavior.

**What actually needs to be fixed:** The success criterion states `formatPercentage(0)` should return `"0%"` not `"+0%"`. With the current code, `formatPercentage(0)` returns `"0.0%"` (no `+`), which might already satisfy the intent. The REAL bug being guarded against is if someone changes the sign check to `value >= 0`, which would produce `"+0.0%"`. The fix is to normalize `-0` to `0` and ensure the `> 0` check (not `>= 0`) is preserved, AND to handle the question of decimal places for zero.

**Recommended fix for `formatPercentage`:**
```typescript
export function formatPercentage(value: number): string {
  const normalized = value === 0 ? 0 : value;  // collapses -0 to 0
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(1)}%`;
}
```

**Test matrix for formatting.ts:**
| Call | Expected | Notes |
|------|----------|-------|
| `formatPercentage(10)` | `'+10.0%'` | Positive |
| `formatPercentage(-10)` | `'-10.0%'` | Negative (toFixed adds sign) |
| `formatPercentage(0)` | `'0.0%'` | No sign |
| `formatPercentage(-0)` | `'0.0%'` | -0 normalized, no sign |
| `formatCurrency(1234.5, 'USD')` | `'$1,234.50'` | Intl delegate |
| `formatCurrencyChange(10, 'USD')` | `'+$10.00'` | Positive |
| `formatCurrencyChange(-0, 'USD')` | `'$0.00'` | No +$ artifact |

---

### `src/analytics/recommendations.ts` — `generateSalesRecommendations`
```typescript
export function generateSalesRecommendations(signals: SalesSignals): string[]
```

Where `SalesSignals`:
```typescript
{
  revenueDown: boolean;
  revenueUp: boolean;
  ordersDown: boolean;
  ordersUp: boolean;
  aovDown: boolean;
  noSales: boolean;
  stableRevenue: boolean;
}
```

**Recommendation fire matrix:**

| Condition | Recommendations fired |
|-----------|----------------------|
| `revenueDown: true` OR `ordersDown: true` | Promotional campaign + email marketing (2 items) |
| `aovDown: true` | Product bundles + free shipping threshold (2 items) |
| `revenueUp: true` OR `ordersUp: true` | Capitalize on momentum + analyze growth drivers (2 items) |
| `noSales: true` OR `stableRevenue: true` | Review marketing channels + A/B tests (2 items) |
| `ordersUp: true` | Ensure sufficient stock (1 item) |
| Always | Monitor key metrics daily (1 item, always last) |

**Test approach:** Build a zeroed signal object, toggle one field at a time, assert the returned array length and/or contains the expected string fragment. The "always" recommendation should be the last item in every case.

---

## Code Quality Changes (Non-Test Work)

### QUAL-01: Remove OAuth prompts from `src/cli/index.ts`

**Lines to remove (exact):**
```typescript
// Line 78:
const clientId = await ask('Client ID (optional, press Enter to skip)');
// Line 79:
const clientSecret = await ask('Client Secret (optional, press Enter to skip)');
```

**Conditional lines that also become dead (lines 97–98):**
```typescript
if (clientId) envContent += `SHOPIFY_CLIENT_ID=${clientId}\n`;
if (clientSecret) envContent += `SHOPIFY_CLIENT_SECRET=${clientSecret}\n`;
```

After removal, the `runInit()` function only prompts for `domain` and `token`, then checks for `.env` overwrite, writes `.env`, and prints the Claude Desktop config. No variable declarations for `clientId`/`clientSecret` remain.

Verification: After edit, `runInit()` should have exactly 2 `await ask(...)` calls — `domain` and `token`.

### QUAL-02: Dev scripts already gitignored

**Finding:** `seed.mjs`, `redistribute-dates.mjs`, and `get-token.mjs` are listed in `.gitignore` at the repo root and are NOT returned by `git ls-files`. The success criterion is already satisfied — the scripts exist on disk but are untracked.

**Required action:** Verify with `git ls-files | grep -E "seed|redistribute|get-token"` returns nothing. This is a verification task, not a code change.

If the scripts somehow appear tracked on a different machine (e.g., were staged before .gitignore was updated), the fix is:
```bash
git rm --cached seed.mjs redistribute-dates.mjs get-token.mjs
```

### QUAL-03: `formatPercentage` / `formatCurrencyChange` -0 fix

See "The formatPercentage Bug" section above. The fix is a one-line normalization in each function. The test coverage from TEST-04 will document correct behavior.

---

## `resetShopContextCache()` for Tests

Exported from `src/shopify/shop.ts`:
```typescript
/** Reset cached shop context — for test use only. */
export function resetShopContextCache(): void {
  _shopContext = null;
}
```

**Usage in tests:** This function does NOT need to be tested directly (it resets a module-level variable). It exists so that future integration tests for `getShopContext()` can reset state between test runs. Since Phase 3 tests are unit-only and none call `getShopContext()`, this function is not invoked in Phase 3 tests.

If a test file were to mock or call `getShopContext()`, the pattern would be:
```typescript
import { resetShopContextCache } from '../../shopify/shop.js';
afterEach(() => resetShopContextCache());
```

---

## Common Pitfalls

### Pitfall 1: `.js` extension resolution failure
**What goes wrong:** `import { calculateChange } from '../analytics/comparisons.js'` in a test file causes "Cannot find module" in vitest because vitest sees no `.js` file at that path (only `.ts`).
**Why it happens:** Node16 TypeScript requires `.js` extensions in imports, but vitest's bundler resolves `.ts` files. Without `resolve.extensions` configuration, vitest doesn't know to try `.ts` for a `.js` import.
**How to avoid:** Include `resolve.extensions: ['.ts', '.js', '.json']` in `vitest.config.ts`. This tells vitest's resolver to attempt these extensions when a bare `.js` path is requested.
**Warning signs:** Error message contains "Cannot find module '…comparisons.js'" during `npm test`.

### Pitfall 2: `globals: true` requiring @types/node additions
**What goes wrong:** If `globals: true` is set, `describe`/`it`/`expect` are injected globally but TypeScript doesn't know about them without `@vitest/globals` types in tsconfig.
**How to avoid:** Use `globals: false` (default) and import from `vitest` explicitly. No extra tsconfig change needed.

### Pitfall 3: `-0` in JavaScript
**What goes wrong:** `typeof -0 === 'number'` is true, `-0 === 0` is true, but `Object.is(-0, 0)` is false. `(-0).toFixed(1)` returns `"0.0"` (no sign) in V8. The bug is not a visible output corruption — it's the risk that a future guard like `value >= 0 ? '+' : ''` would produce `"+0.0%"` for zero inputs.
**How to avoid:** Normalize: `const normalized = value === 0 ? 0 : value` collapses `-0` to `0` before the sign check. Document this in a comment.

### Pitfall 4: Date-dependent tests for `today`/`yesterday`/`week`/`month`
**What goes wrong:** Testing that `getPeriodDates('today').start` equals a specific date makes tests fail the next day.
**How to avoid:** Assert structural properties only — `start <= end`, `end.getHours() === 23`, `end.getMinutes() === 59`. Only `custom` period tests can use fixed date strings.

### Pitfall 5: `package.json` `"test"` script using `vitest` vs `vitest run`
**What goes wrong:** `"test": "vitest"` runs in watch mode by default, which hangs in CI.
**How to avoid:** Use `"test": "vitest run"` for single-pass execution. Add `"test:watch": "vitest"` separately if interactive development is desired.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest runtime | Yes | v24.14.0 | — |
| npm | package install | Yes | 11.9.0 | — |
| vitest | TEST-01 through TEST-05 | No (not installed yet) | — | Install in Wave 0 |
| TypeScript | existing build | Yes (devDep) | ^5.0.0 | — |

**Missing dependencies with no fallback:**
- `vitest` and `@vitest/coverage-v8` — must be installed in Wave 0 via `npm install -D vitest@4.1.1 @vitest/coverage-v8@4.1.1`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | `shopify-insights-mcp/vitest.config.ts` (Wave 0 — does not exist yet) |
| Quick run command | `cd shopify-insights-mcp && npm test` |
| Full suite command | `cd shopify-insights-mcp && npm test` (same — all tests are fast unit tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `npm test` exits 0 with vitest output | smoke | `cd shopify-insights-mcp && npm test` | Wave 0 |
| TEST-02 | `calculateChange` returns correct direction/percentage/value | unit | `cd shopify-insights-mcp && npm test` | Wave 0 |
| TEST-03 | `getPeriodDates` / `getPreviousPeriodDates` return correct ranges | unit | `cd shopify-insights-mcp && npm test` | Wave 0 |
| TEST-04 | `formatPercentage(0)` → `'0.0%'`; `formatPercentage(-0)` → `'0.0%'` | unit | `cd shopify-insights-mcp && npm test` | Wave 0 |
| TEST-05 | `generateSalesRecommendations` fires correct recommendations per signal | unit | `cd shopify-insights-mcp && npm test` | Wave 0 |
| QUAL-01 | `runInit()` has exactly 2 `await ask(...)` calls | manual verify / grep | `grep -c "await ask" shopify-insights-mcp/src/cli/index.ts` | N/A (code edit) |
| QUAL-02 | `git ls-files` returns nothing for the 3 dev scripts | manual verify | `git ls-files \| grep -E "seed\|redistribute\|get-token"` | N/A (already done) |
| QUAL-03 | `formatPercentage(-0)` returns `'0.0%'` with no `+` prefix | unit | covered by TEST-04 test file | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd shopify-insights-mcp && npm test`
- **Per wave merge:** `cd shopify-insights-mcp && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `shopify-insights-mcp/vitest.config.ts` — required before any test runs
- [ ] `shopify-insights-mcp/src/__tests__/comparisons.test.ts` — covers TEST-02
- [ ] `shopify-insights-mcp/src/__tests__/dates.test.ts` — covers TEST-03
- [ ] `shopify-insights-mcp/src/__tests__/formatting.test.ts` — covers TEST-04, QUAL-03
- [ ] `shopify-insights-mcp/src/__tests__/recommendations.test.ts` — covers TEST-05
- [ ] `npm install -D vitest@4.1.1 @vitest/coverage-v8@4.1.1` in `shopify-insights-mcp/`
- [ ] `package.json` scripts: add `"test": "vitest run"`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Jest + ts-jest for TypeScript | Vitest (no transpiler config) | ~2022 | Zero-config TypeScript in test runner |
| `vitest` (watch mode) as `npm test` | `vitest run` for CI | vitest 0.x | Prevents hanging in non-interactive shells |
| `@types/jest` globals | Import from `'vitest'` | vitest 1.x | Explicit, no global pollution |

---

## Open Questions

1. **Does Phase 2 leave `src/shopify/shop.ts` with the `resetShopContextCache` already merged?**
   - What we know: STATE.md confirms Phase 2 is complete; the function appears at line 21 of the current `shop.ts`
   - What's unclear: Whether `presentation` branch already contains this or if it's in a pending commit
   - Recommendation: Verify with `git diff main -- src/shopify/shop.ts` before writing tests that reference it

2. **Should `formatPercentage` round to 0 decimal places for zero values (return `"0%"` not `"0.0%"`)?**
   - What we know: Success criterion says "returns `0%` not `+0%`" — this suggests `"0%"` without decimal
   - What's unclear: Whether that's the intended output or just a shorthand in the requirements
   - Recommendation: Default to `"0%"` for zero in the fix (special-case: `value === 0 ? '0%' : ...`) and write the test to assert `"0%"`; this satisfies the requirement literally

---

## Sources

### Primary (HIGH confidence)
- `npm view vitest version` registry query — vitest 4.1.1, @vitest/coverage-v8 4.1.1 (2026-03-23)
- `shopify-insights-mcp/src/**/*.ts` direct file reads — all function signatures, line numbers, and bugs confirmed from source
- `shopify-insights-mcp/.gitignore` — confirms dev scripts are already excluded

### Secondary (MEDIUM confidence)
- [Vitest official guide](https://vitest.dev/guide/) — `defineConfig`, environment: node, test script
- [DEV Community: vitest .js extension resolution](https://dev.to/techresolve/solved-how-to-not-require-js-extension-when-writing-vitest-tests-2i9a) — `resolve.extensions` pattern verified by vitest docs config page

### Tertiary (LOW confidence)
- [GitHub vitest issue #5820](https://github.com/vitest-dev/vitest/issues/5820) — confirms Node16 moduleResolution is a known friction point; workarounds discussed but no canonical resolution in vitest docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed from npm registry
- Architecture: HIGH — function signatures read directly from source; vitest config pattern verified from official docs and community source
- Pitfalls: HIGH for .js extension issue (confirmed known problem), MEDIUM for -0 behavior (JavaScript spec, verified in V8)
- QUAL findings: HIGH — exact lines identified in source files; gitignore status confirmed via `git ls-files`

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (vitest releases frequently; verify version before install if delayed)
