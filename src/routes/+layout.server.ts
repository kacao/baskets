import { isLocale } from '$lib/i18n';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const cookie = cookies.get('locale') ?? 'en';
	return {
		user: locals.user,
		locale: isLocale(cookie) ? cookie : 'en'
	};
};
