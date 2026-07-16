# 021 — Add easing tokens + motion hygiene in the foundation layer

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Easing & duration / Accessibility
- **Estimated scope**: 4 files (app.css, src/lib/transitions.ts, BoardView.svelte, ConfirmModal.svelte), ~30 lines

## Problem

1. `src/app.css:36-38` defines duration tokens but **no easing tokens** exist anywhere. Deliberate curves are hand-typed one-offs and ~100 component transitions fall back to weak built-in `ease`:

```css
/* src/app.css:35-38 — current */
/* motion — quiet and quick, ≤200ms */
--dur-fast: 100ms;
--dur: 150ms;
--dur-slow: 200ms;
```

2. `src/app.css:242-244` — the tooltip entrance uses bare `ease` (entrances should be ease-out):

```css
/* src/app.css (inside .app-tooltip) — current */
transition:
	opacity var(--dur-fast, 0.12s) ease,
	transform var(--dur-fast, 0.12s) ease;
```

3. `src/app.css:301` — `.stagger-in` children animate for 0.42s, the only >300ms UI duration in the app:

```css
/* current */
animation: staggerIn 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
```

4. `src/app.css:310-317` — the reduced-motion rule zeroes EVERY transition, including pure opacity/color feedback (tooltip fade, hover tints). Reduced motion should drop movement, not all feedback:

```css
/* current */
/* Reduced motion: kill transitions */
@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		transition-duration: 0.01ms !important;
	}
}
```

5. Svelte transition-directive durations are hand-typed literals that drift off the token scale: `src/lib/components/views/BoardView.svelte:488` uses `animate:flip={{ duration: 220 }}` (above the app's documented ≤200ms ceiling), `src/lib/components/ConfirmModal.svelte:39,47` use `120`.

## Target

```css
/* src/app.css — target token block */
/* motion — quiet and quick, ≤200ms */
--dur-fast: 100ms;
--dur: 150ms;
--dur-slow: 200ms;
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
```

```css
/* target tooltip transition */
transition:
	opacity var(--dur-fast, 0.12s) var(--ease-out),
	transform var(--dur-fast, 0.12s) var(--ease-out);
```

```css
/* target stagger */
animation: staggerIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
```

```css
/* target reduced-motion: kill keyframe entrances + movement, keep opacity/color feedback */
@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.01ms !important;
		transition-property: opacity, color, background-color, border-color, box-shadow !important;
	}
}
```

```ts
// src/lib/transitions.ts — target additions (top of file, after imports)
export const DUR_FAST = 100;
export const DUR = 150;
export const DUR_SLOW = 200;
```

- `BoardView.svelte:488`: `animate:flip={{ duration: 220 }}` → import `DUR_SLOW` from `$lib/transitions` and use `animate:flip={{ duration: DUR_SLOW }}`.
- `ConfirmModal.svelte:39,47`: `duration: 120` → import `DUR` from `$lib/transitions`, use `duration: DUR` in both directives (`transition:fade={{ duration: DUR }}`, `transition:scale={{ duration: DUR, start: 0.96 }}`).

## Repo conventions to follow

- Tokens live in the `:root`/theme block of `src/app.css` next to `--dur-fast` (line 36). Tabs for indentation, single quotes in TS.
- `src/lib/transitions.ts` is the shared motion module (exports `popover`); JS constants belong there.

## Steps

1. `src/app.css`: add the two `--ease-*` tokens directly below `--dur-slow` (line 38).
2. `src/app.css` `.app-tooltip` block (~line 242): replace both `ease` keywords with `var(--ease-out)`.
3. `src/app.css` `.stagger-in > *` (~line 301): change `0.42s` to `0.28s` (keep the curve and the delay rules untouched).
4. `src/app.css` reduced-motion block (~line 310): replace `transition-duration: 0.01ms !important;` with `transition-property: opacity, color, background-color, border-color, box-shadow !important;` and update the comment to `/* Reduced motion: drop movement, keep opacity/color feedback */`.
5. `src/lib/transitions.ts`: export `DUR_FAST = 100`, `DUR = 150`, `DUR_SLOW = 200`.
6. `src/lib/components/views/BoardView.svelte:488`: `220` → `DUR_SLOW` (add the import).
7. `src/lib/components/ConfirmModal.svelte:39,47`: `120` → `DUR` (add the import).

## Boundaries

- Do NOT migrate the ~100 component-scoped `ease` usages in this plan — only the tooltip block listed. (Later plans and future work adopt the tokens incrementally.)
- Do NOT touch `pageFade`, the auth/invite `drop-in` keyframes, or `mobile.css`.
- Do NOT change any duration semantics other than the three listed (stagger 0.42→0.28, flip 220→200, confirm 120→150).
- If a cited line doesn't match, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → 0 svelte-check errors, all unit tests pass. `grep -c "ease-out" src/app.css` ≥ 1.
- **Feel check**: hover an icon button — tooltip rises with a crisp ease-out. Load /projects — the grid cascade completes faster but keeps its stagger. In DevTools Rendering panel, emulate `prefers-reduced-motion: reduce`: hover tints and tooltip fades still transition; the projects-grid entrance and auth drop-in do not move.
- **Done when**: tokens exist, all 7 steps applied, verify green.
