import { derived, writable } from 'svelte/store';

/**
 * Minimal i18n: English strings ARE the keys (en = passthrough). The app is
 * English-only; the `$t()` wrapper is kept so UI strings stay greppable and a
 * second locale can be reintroduced by adding a dictionary.
 * Usage: {$t('Sign out')} or $t('{n} task(s)', { n: 3 }).
 */

export const LOCALES = [{ code: 'en', label: 'English' }] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const locale = writable<Locale>('en');

export function isLocale(value: string): value is Locale {
	return LOCALES.some((l) => l.code === value);
}

/** Dictionaries for non-English locales. Keys are the English strings. */
const dictionaries: Record<string, Record<string, string>> = {};

export function registerDictionary(code: string, dict: Record<string, string>) {
	dictionaries[code] = { ...dictionaries[code], ...dict };
}

export const t = derived(locale, (l) => (key: string, params?: Record<string, string | number>) => {
	let s = l === 'en' ? key : (dictionaries[l]?.[key] ?? key);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.replaceAll(`{${k}}`, String(v));
		}
	}
	return s;
});
