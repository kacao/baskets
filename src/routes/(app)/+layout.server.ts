import { redirect } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { project } from '$lib/server/db/schema';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login');
	}

	const projects = await db
		.select({ id: project.id, name: project.name })
		.from(project)
		.orderBy(asc(project.name));

	return {
		user: locals.user,
		projects
	};
};
