import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import type { RequestHandler } from './$types';

/**
 * Current session identity. Used by the realtime transport (ADR-026) to
 * authenticate a /ws upgrade by forwarding the session cookie, and usable by
 * REST clients to confirm who a key belongs to.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	return json({ user: { id: locals.user.id, name: locals.user.name } });
};
