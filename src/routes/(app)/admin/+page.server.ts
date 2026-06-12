import { error } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user?.role !== 'admin') {
		error(403, 'Admins only');
	}

	const users = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			banned: user.banned,
			twoFactorEnabled: user.twoFactorEnabled,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(asc(user.createdAt));

	return { users };
};
