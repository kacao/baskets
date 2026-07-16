# 022 — Remove animations from constant-frequency surfaces

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 5 files, ~10 deleted lines

## Problem

The audit's frequency rule: elements hit 100+ times/day get **no animation, ever**; keyboard-initiated actions especially. Five constant-frequency surfaces animate on every open/close:

```svelte
<!-- src/lib/components/Popover.svelte:104 — current (backs the TaskPanel pill popovers: Priority/Assignee/Milestone/Due/…, opened constantly, Escape-closed) -->
use:floating transition:popover >
```

```svelte
<!-- src/lib/components/StatusSelect.svelte:64 — current (status picker, fired constantly in every view row and pane) -->
		<div class="status-pop" role="listbox" transition:popover>
```

```svelte
<!-- src/lib/components/SidePane.svelte:120 — current (the task pane, the single most-used surface; closes on Escape) -->
transition:fly={{ x: 16, duration: 150 }}
```

```svelte
<!-- src/lib/components/views/ListView.svelte:296 — current (sub-task expand/collapse toggle; TableView's sub-rows already appear instantly) -->
			<ul class="subs" transition:slide={{ duration: 120 }}>
```

```svelte
<!-- src/routes/(app)/+layout.svelte:269 — current (sidebar project sub-nav, auto-expands on every project navigation) -->
							<div class="proj-sub" transition:slide={{ duration: 150 }}>
```

## Target

All five directives deleted. The elements appear/disappear instantly. No replacement animation.

## Repo conventions to follow

- After removing a directive, remove its import if it is now unused in that file (`npm run lint` flags unused imports as warnings; svelte-check may error).
- `src/routes/(app)/+layout.svelte` still uses `slide` at line 368 (the appearance menu — converted by plan 023, not this one) — keep the `slide` import there.

## Steps

1. `src/lib/components/Popover.svelte:104`: delete the `transition:popover` line. Remove the `import { popover } from '$lib/transitions';` (line 3) if now unused in the file.
2. `src/lib/components/StatusSelect.svelte:64`: delete `transition:popover` from the `.status-pop` div. Remove the popover import (line 3) if unused.
3. `src/lib/components/SidePane.svelte:120`: delete the `transition:fly={{ x: 16, duration: 150 }}` line. Remove the `fly` import (line 4) if unused. Note: `src/routes/(app)/+layout.svelte:777` has a comment about clipping "the SidePane's slide-in transform" — leave that CSS alone (harmless), but if the comment sits on a rule that ONLY exists for the fly transform (`overflow` clip), leave the rule and update nothing.
4. `src/lib/components/views/ListView.svelte:296`: delete `transition:slide={{ duration: 120 }}` from the `.subs` ul. Remove the `slide` import (line 3) if unused.
5. `src/routes/(app)/+layout.svelte:269`: delete `transition:slide={{ duration: 150 }}` from the `.proj-sub` div. Keep the `slide` import (still used at line 368).

## Boundaries

- Do NOT touch the project "…" menu (`projects/[id]/+page.svelte:647`), the tab context menu (:991), NotificationBell, FilterBar, or TableView's col-menu — those are tens-per-day menus and keep `transition:popover`.
- Do NOT remove the `.pop`/`.status-pop` transform-origin CSS (plan 024 relies on the pattern for the surfaces that keep motion).
- Do NOT add any replacement transition.
- If a cited line doesn't match, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green; `grep -n "transition:" src/lib/components/Popover.svelte src/lib/components/StatusSelect.svelte src/lib/components/SidePane.svelte` shows no Svelte transition directives (CSS `transition:` properties in `<style>` are fine).
- **Feel check**: open a task → pane appears instantly; press Escape → gone instantly with zero motion. Click a status pill / priority pill repeatedly — the popovers snap open/closed with no lag. Expand sub-tasks in List view — instant, matching Table view.
- **Done when**: all five directives gone, no unused-import errors, verify green.
