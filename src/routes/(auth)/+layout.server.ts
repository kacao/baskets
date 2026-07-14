import { redirect } from '@sveltejs/kit';
import { safeRedirect } from '$lib/safeRedirect';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		// honor a same-origin ?redirect= (e.g. an /invite/<id> deep link that bounced
		// a signed-out user here); default to /projects (ADR-062 W3).
		redirect(302, safeRedirect(url.searchParams.get('redirect')) ?? '/projects');
	}
	return {};
};
