import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { acceptInvitationService } from '$lib/server/orgs';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	// Parity with the browser accept flow (D6): pending + unexpired + the caller's
	// account email must match the invited email (works for a bearer key whose owner's
	// email matches). The link id is the capability.
	const res = await acceptInvitationService(
		{ id: locals.user.id, email: locals.user.email },
		params.id
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ orgId: res.data.orgId });
};
