import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api';
import { generateDueReminders, listForUser, unreadCount } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

/**
 * GET — the current user's notifications plus their unread count. Lazily
 * generates due-date reminders (idempotent per day) on read so the bell stays
 * fresh without a background job.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	await generateDueReminders(locals.user.id);
	const [notifications, unread] = await Promise.all([
		listForUser(locals.user.id),
		unreadCount(locals.user.id)
	]);

	return json({ notifications, unreadCount: unread });
};
