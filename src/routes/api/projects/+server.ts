import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import { apiError, readJson, optionalString, ApiValidationError } from '$lib/server/api';
import { dispatchEvent } from '$lib/server/integrations';
import { createProjectWithDefaults } from '$lib/server/projects';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const projects = await db.select().from(project).orderBy(desc(project.createdAt));
	return json({ projects });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'name is required');
	if (name.length > 120) return apiError(400, 'name too long (max 120)');

	let description: string | null;
	try {
		description = optionalString(body.description, 'description');
	} catch (err) {
		if (err instanceof ApiValidationError) return apiError(400, err.message);
		throw err;
	}

	const id = await createProjectWithDefaults({
		name,
		description,
		creator: locals.user
	});
	const [created] = await db.select().from(project).where(eq(project.id, id));

	void dispatchEvent({ type: 'project.created', actor: locals.user.name, projectName: name });

	return json({ project: created }, { status: 201 });
};
