// Interaction sounds (ADR-063) — a thin app-owned wrapper over the vendored
// cuelume engine. The app decides WHEN to play (restrained, semantic cues only:
// task completion, enabling the setting) and owns the preference; the engine is
// gated globally via its setEnabled().
//
// Preference = `sound` cookie ('on' | absent), default OFF. Read at SSR by the
// root +layout.server.ts load, seeded into the engine by the (app) shell, and
// toggled from the topbar Appearance menu + /settings → Theming. One shared
// reactive state backs BOTH toggle surfaces so neither ever shows a stale value.
import { play, setEnabled } from '$lib/vendor/cuelume/index.js';
import type { SoundName } from '$lib/vendor/cuelume/index.js';

export type { SoundName };

// browser-only writes: a module-level $state is shared across SSR requests,
// so the server must never stamp one user's preference into it
const pref = $state({ on: false });

/** Seed the engine from the server-read cookie (call once from the app shell). */
export function initSound(on: boolean): void {
	if (typeof window === 'undefined') return;
	pref.on = on;
	setEnabled(on);
}

/** Live preference — reactive, safe to read in any template. */
export function soundOn(): boolean {
	return pref.on;
}

/** Flip the preference: gates the engine, persists the cookie, and confirms
 *  enabling with a `toggle` cue so the user hears that audio now works. */
export function setSoundEnabled(on: boolean): void {
	pref.on = on;
	setEnabled(on);
	if (typeof document === 'undefined') return;
	document.cookie = on
		? 'sound=on; path=/; max-age=31536000; samesite=lax'
		: 'sound=; path=/; max-age=0; samesite=lax';
	if (on) play('toggle');
}

/** Play a cue. No-op while disabled, during SSR, or when Web Audio is blocked. */
export function playSound(name: SoundName): void {
	play(name);
}
