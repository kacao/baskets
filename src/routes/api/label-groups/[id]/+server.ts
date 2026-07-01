import { apiError } from '$lib/server/api';
import { deleteLabelGroupById } from '$lib/server/labels';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await deleteLabelGroupById(params.id, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
