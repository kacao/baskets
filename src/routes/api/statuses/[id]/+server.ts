import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import {
	deleteStatusById,
	updateStatusById,
	type UpdateStatusInput
} from '$lib/server/statuses';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const input: UpdateStatusInput = {};
	const has = new Set<keyof UpdateStatusInput>();
	if (body.name !== undefined) {
		input.name = typeof body.name === 'string' ? body.name : '';
		has.add('name');
	}
	if (body.description !== undefined) {
		input.description = typeof body.description === 'string' ? body.description : null;
		has.add('description');
	}
	if (body.category !== undefined) {
		if (typeof body.category !== 'string') return apiError(400, 'category must be a string');
		input.category = body.category;
		has.add('category');
	}
	if (body.color !== undefined) {
		input.color = body.color;
		has.add('color');
	}
	if (body.icon !== undefined) {
		input.icon = body.icon;
		has.add('icon');
	}

	const res = await updateStatusById(params.id, input, locals.user, {
		has: (key) => has.has(key),
		broadcast: true
	});
	if (!res.ok) return apiError(res.status, res.message);
	return json({ status: res.data });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await deleteStatusById(params.id, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
