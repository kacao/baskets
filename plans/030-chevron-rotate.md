# 030 — Collapse chevrons: rotate one glyph instead of swapping two

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 3 files, ~20 lines

## Problem

View group/lane/sub-task chevrons swap between two icon glyphs (`nav-arrow-right` ⇄ `nav-arrow-down`) and teleport, while the sidebar's org/ws chevrons rotate one glyph with a transition (`transition: transform var(--dur-fast) ease` + an `.open` rotate — see `src/routes/(app)/+layout.svelte:478-487`). Same affordance, two mechanisms; the glyph swap gives collapse/expand zero motion feedback.

```svelte
<!-- src/lib/components/views/TableView.svelte:513-515 — current (group header) -->
<Icon name={collapsed[g.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
```

```svelte
<!-- src/lib/components/views/ListView.svelte:177 — current (group header) -->
<Icon name={collapsed[grp.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
```

```svelte
<!-- src/lib/components/views/ListView.svelte:249-253 — current (sub-task toggle) -->
{#if expanded[t.id]}
	<Icon name="nav-arrow-down" size={12} />
{:else}
	<Icon name="nav-arrow-right" size={12} />
{/if}
```

```svelte
<!-- src/lib/components/views/BoardView.svelte:440 — current (lane header) -->
<Icon name={collapsedLanes[lane.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
```

## Target

One `nav-arrow-right` glyph wrapped in a span that rotates 90° when expanded:

```svelte
<span class="chev" class:open={!collapsed[g.key]}><Icon name="nav-arrow-right" size={14} /></span>
```

```css
.chev {
	display: inline-flex;
	transition: transform var(--dur-fast) var(--ease-out);
}
.chev.open {
	transform: rotate(90deg);
}
```

(`--ease-out` exists after plan 021; if it doesn't exist yet, use `ease`.) Under reduced motion the rotation snaps (the app.css reduced-motion rule drops `transform` from transition-property) — correct.

## Repo conventions to follow

- Exemplar: the sidebar org chevron — `src/routes/(app)/+layout.svelte:478-487` (`.org-chevron { transition: transform var(--dur-fast) ease; }` + `.org-chevron.open { transform: rotate(90deg) }`) — note it rotates from RIGHT (collapsed) to DOWN (open), same as the target.
- Icon component: `<Icon name="nav-arrow-right" size={n} />` (sprite alias, ADR-052).

## Steps

1. `TableView.svelte:513`: wrap the Icon in `<span class="chev" class:open={!collapsed[g.key]}>` with a fixed `nav-arrow-right` name; add the `.chev` CSS to the component's `<style>`.
2. `ListView.svelte:177` (group) and `:249-253` (sub-task toggle, size 12): same treatment (`class:open={!collapsed[grp.key]}` / `class:open={expanded[t.id] ?? false}`); one shared `.chev` rule in the file.
3. `BoardView.svelte:440`: same (`class:open={!collapsedLanes[lane.key]}`).
4. Check `src/lib/mobile.css` for rules targeting these toggle buttons' icons (grep `group-toggle`, `sub-toggle`, `lane-toggle`) — the wrapper span must not break any hover-forcing rule; adjust selectors only if a rule targeted the Icon svg directly.

## Boundaries

- Do NOT touch the sidebar chevrons (already correct) or any other Icon usage.
- Do NOT animate row/height — only the glyph rotation.
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: collapse/expand a table group, a list group, a board lane, and a list sub-task row — the chevron rotates 90° in ~100ms instead of swapping glyphs; with reduced motion emulated it snaps instantly.
- **Done when**: all four sites rotate one glyph, verify green.
