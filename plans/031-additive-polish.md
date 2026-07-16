# 031 — Additive polish: bulk-bar entrance, onboarding drop-in, done-color ease, pill press feedback

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW (missed opportunities — additive)
- **Category**: Missed opportunities / Physicality
- **Estimated scope**: 5 files, ~25 lines

## Problem

Four places that should animate but don't:

A. **Bulk-action bar teleports** — the fixed bottom toolbar pops in/out instantly when selection starts/clears, while the sibling bottom-anchored Toaster flies in.

```svelte
<!-- src/lib/components/BulkActionBar.svelte:71-72 — current -->
{#if count > 0}
	<div class="bulk-bar" role="toolbar" aria-label={$i18n('Bulk actions')}>
```

B. **Onboarding card has zero entrance** — the first-run page whose visual siblings (auth + invite cards) both play `drop-in 0.18s ease-out`.

```svelte
<!-- src/routes/(app)/onboarding/+page.svelte:11-12 — current -->
<div class="onboard">
	<div class="onboard-card">
```

C. **Task-completion color snaps** — the done-dim has no transition:

```css
/* src/lib/components/views/ListView.svelte:385-387 — current */
.row.is-done .title-text {
	color: var(--color-muted);
}
```

```css
/* src/lib/components/TaskPanel.svelte:2296-2298 — current */
.sub-item.is-done .sub-title-btn {
	color: var(--color-muted);
}
```

D. **No press feedback on the most-pressed pills** — `.pill` (Popover.svelte:117, hover only) and `.status-pill` (StatusSelect.svelte:~105, hover only), while `.cm-confirm`/`.num-step`/`.create-btn` already use an `:active` scale pattern.

## Target

A. `BulkActionBar.svelte`: `import { fly } from 'svelte/transition';` and add `transition:fly={{ y: 12, duration: 150 }}` to the `.bulk-bar` div. NOTE: `.bulk-bar` centers via `transform: translateX(-50%)` (line ~223) — Svelte's `fly` composes with the element's computed transform, so centering is preserved; verify visually.

B. `onboarding/+page.svelte`: add to `.onboard-card`'s style rule `animation: drop-in 0.18s ease-out;` plus the keyframes, exactly matching the sibling ((auth)/+layout.svelte:35-45):

```css
@keyframes drop-in {
	from {
		transform: translateY(-12px);
		opacity: 0;
	}
	to {
		transform: translateY(0);
		opacity: 1;
	}
}
```

C. Add `transition: color var(--dur) ease;` to the BASE selectors (not the `.is-done` variants): `.title-text` in ListView.svelte and `.sub-title-btn` in TaskPanel.svelte (find their base rules in each file's `<style>`).

D. Press feedback per the audit catalog (`scale(0.97)` on `:active`, `transform 160ms` ease-out):

- `Popover.svelte` `.pill` rule: extend its existing `transition:` list with `transform 160ms var(--ease-out)` and add `.pill:active { transform: scale(0.97); }`
- `StatusSelect.svelte` `.status-pill` rule: same extension + `.status-pill:active:not(.readonly) { transform: scale(0.97); }`
  (`--ease-out` exists after plan 021; fall back to `ease-out` if absent.)

## Repo conventions to follow

- Bottom-anchored entrance exemplar: `src/lib/components/Toaster.svelte` (`fly y:12, 150ms`).
- Entrance keyframes exemplar: `src/routes/(auth)/+layout.svelte:35-45`.
- Press feedback exemplar: `src/routes/(app)/projects/+page.svelte:151-155` (`.create-btn { transition: transform var(--dur-fast); }` + `:active` scale).

## Steps

1. BulkActionBar: import fly, add the directive (A).
2. Onboarding: add animation + keyframes to the scoped style (B).
3. ListView + TaskPanel: add the color transition to the two base rules (C).
4. Popover + StatusSelect: extend transitions, add `:active` scale rules (D).

## Boundaries

- Do NOT re-add open/close transitions to the pill POPOVERS (removed by plan 022) — this is press feedback on the trigger pills only.
- Do NOT change bulk-bar layout/safe-area CSS or the toaster.
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: select a table row — the bulk bar rises 12px into place, centered (no horizontal jump); clear selection — it drops away. Log in with a 0-org account (or visit /onboarding) — the card drops in like the login card. Complete a task in List view — the title dims over 150ms. Press-and-hold a TaskPanel pill / status pill — it compresses slightly; release — it springs back fast.
- **Done when**: all four additions live, centering intact, verify green.
