import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { createOrganizationForUser, listUserOrgs, orgRole } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

const ORG_COLS = {
	id: organization.id,
	name: organization.name,
	slug: organization.slug,
	logo: organization.logo,
	createdAt: organization.createdAt
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// The caller's OWN orgs only (never all orgs), each with the caller's role.
	const userId = locals.user.id;
	const orgs = await listUserOrgs(userId);
	const withRole = await Promise.all(
		orgs.map(async (o) => ({
			id: o.id,
			name: o.name,
			slug: o.slug,
			logo: o.logo,
			createdAt: o.createdAt,
			role: await orgRole(userId, o.id)
		}))
	);
	return json({ orgs: withRole });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'Organization name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	// Any signed-in user may create an org (D8); they become its owner and get a
	// bootstrapped default workspace.
	const orgId = await createOrganizationForUser(locals.user.id, name);
	const [org] = await db.select(ORG_COLS).from(organization).where(eq(organization.id, orgId));
	return json({ org: { ...org, role: 'owner' } }, { status: 201 });
};
