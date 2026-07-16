# 024 — Give the shared popover transition a subtle scale from the trigger

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW (physicality polish)
- **Category**: Physicality & origin
- **Estimated scope**: ~7 files, ~15 lines (1 transition function + transform-origin declarations)

## Problem

The shared `popover` transition emits only opacity + translateY — nothing ever scales, so the placement-aware `transform-origin` declarations that exist in the codebase are dead code, and the menus miss the catalog target (popovers scale from `0.9–0.97` at their trigger, never from center, never `scale(0)`).

```ts
// src/lib/transitions.ts:11-19 — current
export function popover(
	_node: Element,
	{ duration = 150, y = 8 }: { duration?: number; y?: number } = {}
): TransitionConfig {
	return {
		duration,
		easing: cubicOut,
		css: (t) => `opacity: ${t}; transform: translateY(${(t - 1) * y}px);`
	};
}
```

After plan 022, the surfaces still using `transition:popover` are (all open DOWNWARD from their trigger — none flips):

| Surface                     | File:line (directive)            | Alignment                               | Correct origin                                                  |
| --------------------------- | -------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Project "…" menu            | `projects/[id]/+page.svelte:647` | left (`.menu { left: 0 }`, :1780)       | `top left` (already declared :1784)                             |
| View-tab context menu       | `projects/[id]/+page.svelte:991` | positioned at pointer                   | `top left`                                                      |
| Notification bell           | `NotificationBell.svelte:130`    | right (`.bell-pop { right: 0 }`, :195)  | `top right`                                                     |
| Filter pop                  | `FilterBar.svelte:151`           | left (`.filter-pop { left: 0 }`, :302)  | `top left`                                                      |
| Table col-menu              | `TableView.svelte:445`           | right (`.col-menu { right: 0 }`, :1211) | `top right`                                                     |
| Org menu (after plan 023)   | `(app)/+layout.svelte:150`       | below trigger, left                     | `top left`                                                      |
| Workspace menu (after 023)  | `(app)/+layout.svelte:201`       | below trigger, left                     | `top left`                                                      |
| Appearance menu (after 023) | `(app)/+layout.svelte:368`       | below trigger, right-ish                | check its CSS: `right: 0` → `top right`, `left: 0` → `top left` |
| Add-view menu (after 023)   | `projects/[id]/+page.svelte:942` | below tab, left                         | `top left`                                                      |

## Target

```ts
// src/lib/transitions.ts — target css function
css: (t) => `opacity: ${t}; transform: translateY(${(t - 1) * y}px) scale(${0.96 + 0.04 * t});`;
```

Each surface in the table gets an explicit `transform-origin` in its scoped `<style>` (skip any that already declares one, e.g. the project `.menu`).

## Repo conventions to follow

- Exemplar origin declaration: `src/routes/(app)/projects/[id]/+page.svelte:1784` (`.menu { transform-origin: top left; }`).
- Scoped styles live in each component's `<style>` block; tabs for indentation.

## Steps

1. `src/lib/transitions.ts`: add the `scale(${0.96 + 0.04 * t})` term to the css string (target above). Update the function's doc comment to mention the scale.
2. For each surface in the table without a `transform-origin`, add one to its scoped style rule (verify the alignment from the CSS you find — `right: 0` → `top right`, otherwise `top left`).
3. Do NOT add origins to `.pop`/`.status-pop` (Popover.svelte / StatusSelect.svelte) — plan 022 removed their transitions; their existing origin rules may stay as-is.

## Boundaries

- Do NOT re-add transitions to Popover.svelte or StatusSelect.svelte.
- Do NOT change translateY direction or duration.
- Never `scale(0)`; the start scale is exactly `0.96`.
- If a cited line doesn't match, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: open the project "…" menu and the notification bell; in DevTools → Animations panel at 10% speed, confirm each grows from its trigger corner (menu from top-left, bell from top-right) — not from center, and never from zero size.
- **Done when**: scale term present, every animated popover surface has a correct origin, verify green.
