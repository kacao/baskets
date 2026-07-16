# 025 — Board drag release: settle at the drop slot, not snap-back

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file (BoardView.svelte), ~30 lines

## Problem

Releasing a board-card drag snaps the card back to its ORIGIN slot instantly (inline transform cleared while `.bcard.dragging { transition: none }`), and the card only appears in the drop cell after the `?/moveTask` POST + `invalidateAll()` round-trip re-renders the list (the 200ms `animate:flip` then animates that late hop). The released gesture restarts from zero instead of settling where the user dropped it.

```ts
// src/lib/components/views/BoardView.svelte:344-357 — current
	function cleanupDrag() {
		if (holdTimer) clearTimeout(holdTimer);
		holdTimer = null;
		window.removeEventListener('pointermove', cardPointerMove);
		window.removeEventListener('pointerup', cardPointerUp);
		window.removeEventListener('pointercancel', cardPointerCancel);
		if (dragCardEl) {
			dragCardEl.style.transform = '';
			…
```

```ts
// BoardView.svelte:329-335 — current
function cardPointerUp(e: PointerEvent) {
	if (e.pointerId !== dragPointerId) return;
	const wasDragging = dragEngaged;
	cleanupDrag();
	if (wasDragging) void onDrop();
}
```

```ts
// BoardView.svelte:171-179 — current (cells derive purely from the `tasks` prop)
const topTasks = $derived(
	tasks
		.filter((t) => !t.parentId)
		.slice()
		.sort((a, b) => a.position - b.position)
);
const cellTasks = (laneKey: string, statusId: string) =>
	topTasks.filter((t) => t.statusId === statusId && inLane(t, laneKey));
```

## Target

A state-level optimistic placement (NO manual DOM manipulation — Svelte owns the keyed list):

```ts
let pendingMove = $state<{ id: string; lane: string; statusId: string; index: number } | null>(
	null
);
```

- `onDrop()` sets `pendingMove = { id, lane: over.lane, statusId: over.statusId, index: idx }` (using the same `idx` it already computes) BEFORE firing the `?/moveTask` fetch.
- `cellTasks(laneKey, statusId)` consults it: filter the pending task OUT of whatever cell its data says, and splice it INTO the pending cell at `pendingMove.index` when `laneKey === pendingMove.lane && statusId === pendingMove.statusId`.
- An `$effect` clears `pendingMove` whenever the `tasks` prop identity changes (the post-`invalidateAll` data now includes the real move):

```ts
$effect(() => {
	tasks;
	pendingMove = null;
});
```

Result: on release the card immediately RENDERS in the drop slot (state-driven re-render; the `animate:flip` on `.bcard-slot` animates displaced neighbors), no snap-back, and when the server data lands nothing visibly changes.

## Repo conventions to follow

- Svelte 5 runes (`$state`, `$derived`, `$effect`) — this component already uses them throughout.
- Fire-and-forget server writes with `invalidateAll()` refresh: see the existing `onDrop` body (~line 370+).

## Steps

1. Add the `pendingMove` state near the other drag state declarations (around `dragId`/`over`).
2. In `onDrop()` (~line 370): after computing `id`, `idx`, and the no-op check, set `pendingMove` before the fetch/patch calls. Read the full function first — it also patches milestone/assignee for cross-lane drags; `pendingMove` covers visual placement for ALL groupBy modes because `cellTasks` is the single cell source.
3. Rewrite `cellTasks` to apply the override:
   ```ts
   const cellTasks = (laneKey: string, statusId: string) => {
   	let cell = topTasks.filter((t) => t.statusId === statusId && inLane(t, laneKey));
   	if (pendingMove) {
   		cell = cell.filter((t) => t.id !== pendingMove.id);
   		if (pendingMove.lane === laneKey && pendingMove.statusId === statusId) {
   			const moved = topTasks.find((t) => t.id === pendingMove.id);
   			if (moved) cell.splice(Math.min(pendingMove.index, cell.length), 0, moved);
   		}
   	}
   	return cell;
   };
   ```
4. Add the `$effect` that clears `pendingMove` on `tasks` change.
5. If `onDrop`'s error path (`fetch` failure / non-ok response) exists, clear `pendingMove` there too so a failed move visibly reverts.

## Boundaries

- Do NOT manipulate DOM nodes directly or add optimistic writes for any other field.
- Do NOT change `moveTask` server behavior, the hold-to-engage gesture, or `animate:flip`.
- Do NOT touch label-lane semantics (cross-label-lane drags change status/position only — the visual override via `cellTasks` is still correct since it keys on the drop cell).
- If the code has drifted from the excerpts, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check** (needs `npm run dev` + a board with several tasks): drag a card to another column and release — the card stays in the drop slot with NO flash back to its origin; neighbors flip smoothly. Drag within a column to reorder — same. Try a grouped board (Customize → Group by milestone): cross-lane drag settles in the target lane cell. Kill the network (DevTools offline) and drag — the card reverts when the request fails.
- **Done when**: no visible snap-back on release in any groupBy mode, verify green.
