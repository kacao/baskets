import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { organization } from '$lib/server/db/schema';
import { apiError, readJson } from '$lib/server/api';
import { deleteOrganizationGuarded, orgRole, updateOrganizationService } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

const ORG_COLS = {
	id: organization.id,
	name: organization.name,
	slug: organization.slug,
	logo: organization.logo,
	createdAt: organization.createdAt
};

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// ADR-019: a non-member must not tell a real org from a missing one — 404 either way.
	const role = await orgRole(locals.user.id, params.id);
	if (!role) return apiError(404, 'Organization not found');

	const [org] = await db.select(ORG_COLS).from(organization).where(eq(organization.id, params.id));
	if (!org) return apiError(404, 'Organization not found');
	return json({ org: { ...org, role } });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');
	if (body.name === undefined) return apiError(400, 'No fields to update');

	// The service gates (404 non-member / 403 non-admin) BEFORE validating the name,
	// preserving ADR-019 ordering; a non-string name collapses to the empty-name 400.
	const name = typeof body.name === 'string' ? body.name : '';
	const res = await updateOrganizationService(locals.user.id, params.id, { name });
	if (!res.ok) return apiError(res.status, res.message);

	const [org] = await db.select(ORG_COLS).from(organization).where(eq(organization.id, params.id));
	return json({ org });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// Owner-only, and only when the org has 0 workspaces (D8); the service maps the
	// full 404/403/400 matrix.
	const res = await deleteOrganizationGuarded(params.id, locals.user.id);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
