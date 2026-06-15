import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { markAllRead } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

/** Mark all of the current user's notifications read. */
const handler: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	const count = await markAllRead(locals.user.id);
	return json({ ok: true, count });
};

export const POST = handler;
export const PATCH = handler;
