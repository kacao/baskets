import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { markRead } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

/** Mark a single notification read (scoped to the owner). */
const handler: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	const ok = await markRead(params.id, locals.user.id);
	if (!ok) return apiError(404, 'Notification not found');
	return json({ ok: true });
};

export const POST = handler;
export const PATCH = handler;
