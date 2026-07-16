# 023 — Unify dropdown-menu entrances on the shared popover transition

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Easing & duration
- **Estimated scope**: 2 files, ~8 lines

## Problem

Sibling trigger-anchored dropdown menus use three different entrances while the app standard for this pattern is the shared `popover` transition (150ms cubicOut, translateY(-8→0)+fade — used by the project "…" menu, tab context menu, NotificationBell, FilterBar, TableView col-menu). Svelte's `fade` default easing is `linear` — flagged for entrances.

```svelte
<!-- src/routes/(app)/+layout.svelte:150 — current (org switcher) -->
						<div class="pop-menu" transition:fade={{ duration: 100 }}>
```

```svelte
<!-- src/routes/(app)/+layout.svelte:201 — current (workspace switcher) -->
							<div class="ws-menu" transition:fade={{ duration: 100 }}>
```

```svelte
<!-- src/routes/(app)/+layout.svelte:368 — current (appearance menu) -->
						<div class="appr-menu" role="menu" transition:slide={{ duration: 120 }}>
```

```svelte
<!-- src/routes/(app)/projects/[id]/+page.svelte:942 — current (viewbar add-view menu) -->
					<div class="add-view-menu" transition:slide={{ duration: 150 }}>
```

## Target

All four use the shared transition:

```svelte
<div class="pop-menu" transition:popover>
<div class="ws-menu" transition:popover>
<div class="appr-menu" role="menu" transition:popover>
<div class="add-view-menu" transition:popover>
```

## Repo conventions to follow

- `import { popover } from '$lib/transitions';` — see `src/lib/components/FilterBar.svelte:7` for the exemplar. `projects/[id]/+page.svelte` already imports it (line 10).
- Exemplar usage: `src/lib/components/NotificationBell.svelte:130`.

## Steps

1. `src/routes/(app)/+layout.svelte`: add `import { popover } from '$lib/transitions';` next to the existing svelte/transition import (line 4).
2. Line 150: `transition:fade={{ duration: 100 }}` → `transition:popover`.
3. Line 201: `transition:fade={{ duration: 100 }}` → `transition:popover`.
4. Line 368: `transition:slide={{ duration: 120 }}` → `transition:popover`.
5. After steps 2-4, remove `fade` and/or `slide` from the svelte/transition import in that file if no longer used anywhere in it (check with grep first — `slide` at line 269 is removed by plan 022; if plan 022 has not run yet and line 269 still uses `slide`, keep the import).
6. `src/routes/(app)/projects/[id]/+page.svelte:942`: `transition:slide={{ duration: 150 }}` → `transition:popover`.

## Boundaries

- Do NOT convert genuine inline accordions: the sidebar `.proj-sub` (layout:269, plan 022 deletes it) and the project-menu `.submenu` (projects page :1020) stay as-is.
- Do NOT change menu markup, roles, or positioning CSS (transform-origins are plan 024).
- If a cited line doesn't match, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: open the org switcher, workspace switcher, Appearance menu, and the viewbar "+" menu — all four now rise 8px with a fade like the notification bell, no height-reveal slide, no flat linear fade.
- **Done when**: four directives converted, imports clean, verify green.
