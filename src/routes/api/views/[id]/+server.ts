import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { deleteViewById, updateViewById } from '$lib/server/views';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const res = await updateViewById(
		params.id,
		{
			name: typeof body.name === 'string' ? body.name : undefined,
			config: body.config,
			hidden: body.hidden as boolean | undefined
		},
		locals.user,
		{ has: (key) => body[key] !== undefined, broadcast: true }
	);
	if (!res.ok) return apiError(res.status, res.message);
	return json({ view: res.data });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await deleteViewById(params.id, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
