import { error, fail } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { status, task } from '$lib/server/db/schema';
import { isAdmin } from '$lib/server/permissions';
import { listStatuses, STATUS_CATEGORIES, type StatusCategory } from '$lib/server/statuses';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!isAdmin(locals.user)) error(403, 'Admins only');

	const statuses = await listStatuses();
	const usage = await db
		.select({ statusId: task.statusId, n: count(task.id) })
		.from(task)
		.groupBy(task.statusId);

	return {
		statuses: statuses.map((s) => ({
			...s,
			inUse: usage.find((u) => u.statusId === s.id)?.n ?? 0
		})),
		categories: STATUS_CATEGORIES
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const category = String(form.get('category') ?? 'todo');

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const existing = await db.select().from(status).where(eq(status.name, name));
		if (existing.length > 0) return fail(400, { message: 'A status with that name exists' });

		const all = await listStatuses();
		await db.insert(status).values({
			id: crypto.randomUUID(),
			name,
			category,
			position: (all.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: new Date()
		});
		return { success: true };
	},

	rename: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		if (!id || !name) return fail(400, { message: 'Name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });

		await db.update(status).set({ name }).where(eq(status.id, id));
		return { success: true };
	},

	delete: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s) return fail(404, { message: 'Status not found' });
		if (s.builtIn) return fail(400, { message: 'Built-in statuses cannot be deleted' });

		const [{ n }] = await db
			.select({ n: count(task.id) })
			.from(task)
			.where(eq(task.statusId, id));
		if (n > 0) return fail(400, { message: `Status is used by ${n} task(s)` });

		await db.delete(status).where(eq(status.id, id));
		return { success: true };
	}
};
