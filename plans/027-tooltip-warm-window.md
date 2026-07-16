# 027 — Tooltip warm window: instant follow-up tooltips

- **Status**: DONE
- **Commit**: e3e25a4
- **Severity**: MEDIUM
- **Category**: Easing & duration (tooltip cadence)
- **Estimated scope**: 2 files (tooltip.ts, app.css), ~15 lines

## Problem

Sweeping across a toolbar of icon buttons re-pays the full 350ms delay AND the fade on every single tooltip. After the first tooltip, follow-ups should be instant.

```ts
// src/lib/tooltip.ts:66-74 — current show()
const show = () => {
	if (!opts.text) return;
	if (showTimer) clearTimeout(showTimer);
	showTimer = setTimeout(() => {
		const el = ensureEl();
		el.textContent = opts.text;
		position(node, opts.placement);
		el.classList.add('app-tooltip--visible');
		window.addEventListener('scroll', hideTip, true);
	}, opts.delay);
};
```

```ts
// src/lib/tooltip.ts:45-50 — current hideTip()
function hideTip() {
	if (showTimer) clearTimeout(showTimer);
	showTimer = null;
	tipEl?.classList.remove('app-tooltip--visible');
	window.removeEventListener('scroll', hideTip, true);
}
```

## Target

A module-level warm window: if a tooltip was visible within the last 300ms, the next one shows immediately AND without the fade/rise (an `--instant` class that suppresses the transition).

```ts
// module scope, next to `tipEl`/`showTimer`
let lastHiddenAt = 0;
const WARM_WINDOW = 300;
```

```ts
function hideTip() {
	if (showTimer) clearTimeout(showTimer);
	showTimer = null;
	if (tipEl?.classList.contains('app-tooltip--visible')) lastHiddenAt = Date.now();
	tipEl?.classList.remove('app-tooltip--visible');
	tipEl?.classList.remove('app-tooltip--instant');
	window.removeEventListener('scroll', hideTip, true);
}
```

```ts
const show = () => {
	if (!opts.text) return;
	if (showTimer) clearTimeout(showTimer);
	const warm = Date.now() - lastHiddenAt < WARM_WINDOW;
	const reveal = () => {
		const el = ensureEl();
		el.textContent = opts.text;
		position(node, opts.placement);
		el.classList.toggle('app-tooltip--instant', warm);
		el.classList.add('app-tooltip--visible');
		window.addEventListener('scroll', hideTip, true);
	};
	if (warm) reveal();
	else showTimer = setTimeout(reveal, opts.delay);
};
```

```css
/* src/app.css — next to the .app-tooltip--visible rule (~line 247) */
.app-tooltip--instant {
	transition: none;
}
```

## Repo conventions to follow

- `tooltip.ts` uses one shared floating node with module-scope state (`tipEl`, `showTimer`) — extend that pattern.
- App-level tooltip styling lives in `src/app.css` under `.app-tooltip`.

## Steps

1. Add `lastHiddenAt` + `WARM_WINDOW` module state to `src/lib/tooltip.ts`.
2. Replace `hideTip` and `show` with the target versions (note: `hideTip` must stamp `lastHiddenAt` ONLY when a tooltip was actually visible, and must strip the instant class so a cold show fades again).
3. Add `.app-tooltip--instant { transition: none; }` to `src/app.css`.

## Boundaries

- Do NOT change the positioning/flip logic, the 350ms cold delay, or touch/pen filtering.
- Do NOT change IconPicker's native titles.
- If the code has drifted, STOP and report.

## Verification

- **Mechanical**: `npm run verify` → green.
- **Feel check**: hover the first sidebar/topbar icon — tooltip appears after the normal delay with its fade. Sweep directly to the neighboring icon — its tooltip appears INSTANTLY with no fade. Pause >300ms with no tooltip, hover again — delay + fade are back.
- **Done when**: warm-window behavior observable, cold behavior unchanged, verify green.
