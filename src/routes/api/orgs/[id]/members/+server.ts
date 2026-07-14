import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { listMembers, orgRole } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// D3 roster boundary: ANY member of the org may list the roster; a non-member
	// gets 404 (the org is invisible to them — ADR-019).
	const role = await orgRole(locals.user.id, params.id);
	if (!role) return apiError(404, 'Organization not found');

	const members = await listMembers(params.id);
	return json({ members });
};
