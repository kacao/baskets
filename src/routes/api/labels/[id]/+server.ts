import { json } from '@sveltejs/kit';
import { apiError, readJson } from '$lib/server/api';
import { deleteLabelById, updateLabelById, type UpdateLabelInput } from '$lib/server/labels';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const input: UpdateLabelInput = {};
	const has = new Set<keyof UpdateLabelInput>();
	if (body.name !== undefined) {
		input.name = typeof body.name === 'string' ? body.name : '';
		has.add('name');
	}
	if (body.color !== undefined) {
		input.color = body.color;
		has.add('color');
	}
	if (body.icon !== undefined) {
		input.icon = body.icon;
		has.add('icon');
	}

	const res = await updateLabelById(params.id, input, locals.user, {
		has: (key) => has.has(key),
		broadcast: true
	});
	if (!res.ok) return apiError(res.status, res.message);
	return json({ label: res.data });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const res = await deleteLabelById(params.id, locals.user, { broadcast: true });
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
