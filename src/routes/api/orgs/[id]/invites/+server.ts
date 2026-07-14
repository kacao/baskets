import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { inviteMemberService, listPendingInvitations, orgRole } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// Pending invites are an owner/admin surface: non-member 404 (org invisible),
	// plain member 403 (ADR-019). There is deliberately NO by-email discovery (D6).
	const role = await orgRole(locals.user.id, params.id);
	if (!role) return apiError(404, 'Organization not found');
	if (role !== 'owner' && role !== 'admin') return apiError(403, 'Requires organization admin');

	const invitations = await listPendingInvitations(params.id);
	return json({ invitations });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	// The service gates (owner/admin) + validates email/role. The returned `id` is the
	// capability: the accept link is /invite/<id> (delivered out-of-band; D6).
	const email = typeof body.email === 'string' ? body.email : '';
	const role = typeof body.role === 'string' ? body.role : null;
	const res = await inviteMemberService(locals.user.id, params.id, email, role);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ invitation: res.data }, { status: 201 });
};
