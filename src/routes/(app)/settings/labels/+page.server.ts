import { error, fail } from '@sveltejs/kit';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { label, labelGroup, projectLabel, taskLabel } from '$lib/server/db/schema';
import { isAdmin } from '$lib/server/permissions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!isAdmin(locals.user)) error(403, 'Admins only');

	const [labels, groups, taskUse, projectUse] = await Promise.all([
		db.select().from(label).orderBy(asc(label.position), asc(label.name)),
		db.select().from(labelGroup).orderBy(asc(labelGroup.position), asc(labelGroup.name)),
		db.select({ labelId: taskLabel.labelId, n: count() }).from(taskLabel).groupBy(taskLabel.labelId),
		db
			.select({ labelId: projectLabel.labelId, n: count() })
			.from(projectLabel)
			.groupBy(projectLabel.labelId)
	]);

	return {
		groups,
		labels: labels.map((l) => ({
			...l,
			inUse:
				(taskUse.find((u) => u.labelId === l.id)?.n ?? 0) +
				(projectUse.find((u) => u.labelId === l.id)?.n ?? 0)
		}))
	};
};

export const actions: Actions = {
	createGroup: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Group name is required' });

		const existing = await db.select().from(labelGroup).where(eq(labelGroup.name, name));
		if (existing.length > 0) return fail(400, { message: 'A group with that name exists' });

		await db.insert(labelGroup).values({
			id: crypto.randomUUID(),
			name,
			position: Date.now(),
			createdAt: new Date()
		});
		return { success: true };
	},

	deleteGroup: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// labels in the group survive (groupId set null via FK)
		await db.delete(labelGroup).where(eq(labelGroup.id, id));
		return { success: true };
	},

	createLabel: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const groupId = String(form.get('groupId') ?? '') || null;

		if (!name) return fail(400, { message: 'Label name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });

		const existing = await db.select().from(label).where(eq(label.name, name));
		if (existing.length > 0) return fail(400, { message: 'A label with that name exists' });

		if (groupId) {
			const [g] = await db.select().from(labelGroup).where(eq(labelGroup.id, groupId));
			if (!g) return fail(400, { message: 'Unknown group' });
		}

		await db.insert(label).values({
			id: crypto.randomUUID(),
			name,
			groupId,
			position: Date.now(),
			createdAt: new Date()
		});
		return { success: true };
	},

	deleteLabel: async ({ request, locals }) => {
		if (!isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(label).where(eq(label.id, id));
		return { success: true };
	}
};
