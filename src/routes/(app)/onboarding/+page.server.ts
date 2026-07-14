import { fail, redirect } from '@sveltejs/kit';
import { ORG_COOKIE_OPTS, createOrganizationForUser, listUserOrgs } from '$lib/server/orgs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(302, '/login');
	const orgs = await listUserOrgs(locals.user.id);
	const isNew = url.searchParams.get('new') === '1';
	// a user who already belongs to an org and didn't ask to create another one
	// belongs on /projects (the (app) guard only forces 0-org users here).
	if (orgs.length > 0 && !isNew) redirect(302, '/projects');
	return { isNew, hasOrgs: orgs.length > 0 };
};

export const actions: Actions = {
	create: async ({ request, locals, cookies }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Organization name is required' });
		if (name.length > 120) return fail(400, { message: 'Name too long (max 120)' });

		const orgId = await createOrganizationForUser(locals.user.id, name);
		// make the new org active (D4) and drop any workspace cookie from a prior org.
		// ORG_COOKIE_OPTS keeps the cookie client-writable so the switcher can override it.
		cookies.set('org', orgId, ORG_COOKIE_OPTS);
		cookies.delete('workspace', { path: '/' });
		redirect(303, '/projects');
	}
};
