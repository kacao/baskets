import { error, fail } from '@sveltejs/kit';
import { count, eq, isNull, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { status, task } from '$lib/server/db/schema';
import { isAdmin } from '$lib/server/permissions';
import { parseIconValue } from '$lib/server/icons';
import { listStatuses } from '$lib/server/statuses';
import type { Actions, PageServerLoad } from './$types';

// Default statuses are fixed in name/category/delete — custom statuses live on
// workspaces and projects. Their ICON is editable here (admin-only, app-wide).
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
		}))
	};
};

export const actions: Actions = {
	// Change a built-in default status's icon (app-wide). ensureDefaultStatuses
	// preserves a custom icon across reboots (it only fills the icon when empty),
	// so we require a non-empty icon here — built-ins always keep one.
	setStatusIcon: async ({ request, locals }) => {
		if (!locals.user || !isAdmin(locals.user)) return fail(403, { message: 'Admins only' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const icon = parseIconValue(form.get('icon'));
		if (!icon) return fail(400, { message: 'Pick an icon' });

		// must be an app-wide built-in default (projectId + workspaceId both null)
		const [s] = await db
			.select()
			.from(status)
			.where(and(eq(status.id, id), isNull(status.projectId), isNull(status.workspaceId)));
		if (!s) return fail(400, { message: 'Not a default status' });

		await db.update(status).set({ icon }).where(eq(status.id, id));
		return { success: true };
	}
};
