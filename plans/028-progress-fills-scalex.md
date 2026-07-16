# 028 — Progress fills: animate transform, not width

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 3 files, ~15 lines

## Problem

Three progress/bar fills transition `width` — a layout property (layout + paint + composite per change). Animate `transform`/`opacity` only.

```svelte
<!-- src/lib/components/MilestonesManager.svelte:127 — current -->
<div class="ms-bar-fill" class:full={p.pct === 100} style={`width:${p.pct}%`}></div>
```

```css
/* MilestonesManager.svelte:404-408 — current */
.ms-bar-fill {
	height: 100%;
	background: var(--color-primary, var(--color-base-content));
	transition: width var(--dur) ease;
}
```

```svelte
<!-- src/lib/components/views/DashboardView.svelte:66-69 and 87-90 — current (two .bar-fill sites) -->
<div class="bar-fill" style="width: {top.length > 0 ? (row.count / top.length) * 100 : 0}%"></div>
```

```css
/* DashboardView.svelte:155-159 — current */
.bar-fill {
	height: 100%;
	background: var(--color-fg);
	transition: width 0.2s ease;
}
```

```svelte
<!-- src/routes/(app)/projects/+page.svelte:88 — current -->
<div class="progress-fill" style="width: {(p.doneCount / p.taskCount) * 100}%"></div>
```

```css
/* projects/+page.svelte:145-149 — current */
.progress-fill {
	height: 100%;
	background: var(--color-fg);
	transition: width var(--dur-slow) ease;
}
```

## Target

Each fill renders at `width: 100%` and drives progress via `transform: scaleX(fraction)` (0–1, not percent), with `transform-origin: left` and a tokenized transform transition. Pattern (MilestonesManager example):

```svelte
<div
	class="ms-bar-fill"
	class:full={p.pct === 100}
	style={`transform: scaleX(${p.pct / 100})`}
></div>
```

```css
.ms-bar-fill {
	height: 100%;
	width: 100%;
	transform-origin: left;
	background: var(--color-primary, var(--color-base-content));
	transition: transform var(--dur) ease;
}
```

- DashboardView: `style="transform: scaleX({top.length > 0 ? row.count / top.length : 0})"` (and the milestone one: `{row.total > 0 ? row.done / row.total : 0}`); css `transition: transform var(--dur-slow) ease;` (also fixes the hardcoded `0.2s`).
- projects/+page: `style="transform: scaleX({p.doneCount / p.taskCount})"`; css `transition: transform var(--dur-slow) ease;`.

## Repo conventions to follow

- All three containers (`.ms-bar`, `.bar`, `.progress`) already have `overflow: hidden` or a fixed height — the scaled fill stays clipped. Verify each container clips (add `overflow: hidden` to the container if missing).
- Duration tokens: `var(--dur)` / `var(--dur-slow)` (app.css:36-38).

## Steps

1. `MilestonesManager.svelte`: swap inline `width` for `transform: scaleX(...)`; update `.ms-bar-fill` css (add `width: 100%`, `transform-origin: left`, transition property → `transform`). Check `.ms-bar` has `overflow: hidden` (it does, line ~402).
2. `DashboardView.svelte`: same for both `.bar-fill` sites + css (`0.2s` → `var(--dur-slow)`). Check `.bar` clips; add `overflow: hidden` if not.
3. `projects/+page.svelte`: same for `.progress-fill` + css. Check `.progress` clips; add `overflow: hidden` if not.

## Boundaries

- Do NOT change bar heights, colors, or the `.full` green state.
- Do NOT touch any other width usage.
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: complete a task belonging to a milestone with the Milestones pane open — the milestone bar eases to its new fraction (DevTools Performance shows no layout for the bar). Visual: bars render identical fractions as before (compare a 1/3 bar by eye).
- **Done when**: zero `transition: width` left in the three files (`grep -rn "transition: width" src` → empty), verify green.
