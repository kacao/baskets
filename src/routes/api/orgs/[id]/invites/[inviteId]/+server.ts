import { apiError } from '$lib/server/api';
import { cancelInvitationService } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// The service resolves the invite's own org and gates on it (404 hides other orgs'
	// invites; 403 for a member below admin); the URL org is not a second oracle.
	const res = await cancelInvitationService(locals.user.id, params.inviteId);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
