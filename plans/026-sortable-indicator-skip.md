# 026 — sortable.ts: skip redundant indicator re-insertion per pointermove

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 1 file, ~8 lines

## Problem

During a reorder drag, EVERY `pointermove` calls `placeIndicator()`, which recomputes the target index (reading `getBoundingClientRect()` on every item) and then unconditionally `insertBefore`/`appendChild`s the indicator — a DOM write per move even when the slot hasn't changed, invalidating layout for the next move's rect reads (write-then-read thrash at pointer-move frequency).

```ts
// src/lib/sortable.ts:62-73 — current
function placeIndicator() {
	if (!indicator) {
		indicator = document.createElement('div');
		indicator.className = horiz()
			? 'sortable-indicator sortable-indicator--x'
			: 'sortable-indicator';
	}
	const els = items().filter((el) => el !== dragEl);
	const idx = targetIndex(lastX, lastY);
	if (idx >= els.length) node.appendChild(indicator);
	else node.insertBefore(indicator, els[idx]);
}
```

## Target

```ts
let lastIndicatorIdx = -1;

function placeIndicator() {
	if (!indicator) {
		indicator = document.createElement('div');
		indicator.className = horiz()
			? 'sortable-indicator sortable-indicator--x'
			: 'sortable-indicator';
		lastIndicatorIdx = -1;
	}
	const els = items().filter((el) => el !== dragEl);
	const idx = targetIndex(lastX, lastY);
	if (idx === lastIndicatorIdx && indicator.parentNode === node) return;
	lastIndicatorIdx = idx;
	if (idx >= els.length) node.appendChild(indicator);
	else node.insertBefore(indicator, els[idx]);
}
```

Also reset `lastIndicatorIdx = -1` in `cleanup()` (next to `indicator?.remove()`) so the next drag starts fresh.

**Deliberately NOT in scope**: the release snap-back (the dragged row's transform is cleared on pointerup and the new order appears after the server round-trip). Fixing it would require manual DOM reordering inside a Svelte-keyed list — Svelte owns those nodes, and fighting its keyed diff risks corrupted lists. Documented as rejected; the sortable lists (statuses, custom fields, milestones) are short and the flip-less settle is acceptable.

## Repo conventions to follow

- Module-scope `let` state inside the action closure, as the file already does (`indicator`, `lastX`, `dragEl`).

## Steps

1. Add `lastIndicatorIdx` closure state, the early-return guard, and the two resets exactly as in the target.

## Boundaries

- Do NOT change `targetIndex`, the hold-to-engage logic, or `onReorder` semantics.
- Do NOT attempt the release-settle fix (see above).
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: in a project's Settings → Statuses, drag a custom status slowly within its category — the indicator moves between slots exactly as before, and holding the pointer still causes zero DOM churn (check with DevTools → Performance: no per-frame `insertBefore` while stationary).
- **Done when**: behavior identical, redundant inserts gone, verify green.
