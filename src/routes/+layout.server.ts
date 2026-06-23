import { isLocale } from '$lib/i18n';
import type { LayoutServerLoad } from './$types';

const THEMES = ['light', 'dark'];

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const cookie = cookies.get('locale') ?? 'en';
	const themeCookie = cookies.get('theme');
	return {
		user: locals.user,
		locale: isLocale(cookie) ? cookie : 'en',
		theme: themeCookie && THEMES.includes(themeCookie) ? themeCookie : 'light',
		contrast: cookies.get('contrast') === 'high' ? 'high' : null
	};
};
