import { ICON_NAMES } from '$lib/heroiconNames';

/**
 * Normalize a stored icon value from a form field: an emoji/glyph string, or an
 * `iconoir:<name>` reference (validated against the sprite's icon set — Heroicon
 * names plus legacy iconoir-token aliases; ADR-052). Returns null for empty input
 * or an unknown icon name.
 */
export function parseIconValue(raw: unknown): string | null {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	if (s.startsWith('iconoir:')) return ICON_NAMES.includes(s.slice(8)) ? s : null;
	return s.slice(0, 32);
}
