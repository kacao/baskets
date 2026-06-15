import { ICONOIR_NAMES } from '$lib/iconoirNames';

/**
 * Normalize a stored icon value from a form field: an emoji/glyph string, or an
 * `iconoir:<name>` reference (validated against the icon set). Returns null for
 * empty input or an unknown iconoir name.
 */
export function parseIconValue(raw: unknown): string | null {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	if (s.startsWith('iconoir:')) return ICONOIR_NAMES.includes(s.slice(8)) ? s : null;
	return s.slice(0, 32);
}
