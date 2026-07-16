# 029 — Toaster: bidirectional transition instead of in/out pair

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: LOW
- **Category**: Interruptibility
- **Estimated scope**: 1 file, 2 lines

## Problem

Toasts use an identical `in:fly`/`out:fly` pair. Svelte does NOT reverse separate in/out transitions — click-dismissing a toast during its 150ms entrance plays intro and outro simultaneously (doubled motion) instead of retargeting from the current position.

```svelte
<!-- src/lib/components/Toaster.svelte:12-15 — current -->
animate:flip={{ duration: 150 }}
in:fly={{ y: 12, duration: 150 }}
out:fly={{ y: 12, duration: 150 }}
```

## Target

```svelte
animate:flip={{ duration: 150 }}
transition:fly={{ y: 12, duration: 150 }}
```

Visually identical for uninterrupted toasts; a mid-entrance dismiss reverses cleanly from the current position (bidirectional transitions retarget).

## Repo conventions to follow

- Bidirectional `transition:` directives are the codebase norm (SidePane historically, ConfirmModal, all popovers).

## Steps

1. `src/lib/components/Toaster.svelte`: replace the `in:fly` and `out:fly` lines with the single `transition:fly` line.

## Boundaries

- Do NOT change `animate:flip`, durations, or the toast auto-dismiss timing.
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: trigger a toast (e.g. copy an API key in /settings) and click it immediately during its entrance — it reverses smoothly downward from wherever it was, no double-motion stutter.
- **Done when**: single directive, verify green.
