import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { leaveOrgService, removeMemberService, updateMemberRoleService } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// The service owns all gating (404 non-member / 403 non-admin / owner rules) and
	// the last-owner invariant.
	const role = typeof body.role === 'string' ? body.role : '';
	const res = await updateMemberRoleService(locals.user.id, params.id, params.userId, role);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ member: res.data });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// Removing yourself = leave (owns the last-owner-for-self rule); removing another
	// member = the org-admin removeMember path.
	const res =
		params.userId === locals.user.id
			? await leaveOrgService(locals.user.id, params.id)
			: await removeMemberService(locals.user.id, params.id, params.userId);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
