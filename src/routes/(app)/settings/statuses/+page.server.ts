import { error, fail } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { task } from '$lib/server/db/schema';
import { isAdmin } from '$lib/server/permissions';
import { listStatuses, setDefaultStatusIcon } from '$lib/server/statuses';
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
		const form = await request.formData();
		const res = await setDefaultStatusIcon(
			String(form.get('id') ?? ''),
			form.get('icon'),
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	}
};
