import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { project, view } from './db/schema';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { canAccessProject, canEditProject, canEditView } from '$lib/server/permissions';
import { VIEW_TYPES, type ViewType } from '$lib/server/projects';

/** The acting user; carries `role` so permission checks can honor admin bypass. */
export type Actor = { id: string; role?: string | null } | null | undefined;

export type ServiceResult<T> =
	{ ok: true; data: T } | { ok: false; status: number; message: string };

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
const err = (status: number, message: string): ServiceResult<never> => ({
	ok: false,
	status,
	message
});

type ViewRow = typeof view.$inferSelect;

/* --------------------------------- create --------------------------------- */

export type CreateViewInput = {
	type: string;
	/** REST may pass an explicit name (uniqueness + length checked); the form auto-derives. */
	name?: string;
};

/**
 * Create a view of a type (multiple per type allowed, ADR-020). Gated by project
 * existence + access + canEditProject (404-before-403 per ADR-019). When `name` is
 * given it must be unique + ≤120 (REST); otherwise a unique base name is derived.
 * Mirrors createView form action + POST /api/projects/[id]/views (create branch).
 */
export async function createView(
	projectId: string,
	input: CreateViewInput,
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<ViewRow>> {
	const [proj] = await db.select({ id: project.id }).from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	const type = input.type;
	if (!VIEW_TYPES.includes(type as ViewType)) return err(400, 'Invalid view type');

	const existing = await db
		.select({ name: view.name })
		.from(view)
		.where(eq(view.projectId, projectId));

	let name: string;
	if (input.name !== undefined) {
		name = input.name.trim();
		if (!name) return err(400, 'name cannot be empty');
		if (name.length > 120) return err(400, 'name too long (max 120)');
		if (existing.some((v) => v.name === name))
			return err(400, 'a view with that name already exists');
	} else {
		const base = type[0].toUpperCase() + type.slice(1);
		name = base;
		for (let n = 2; existing.some((v) => v.name === name); n++) name = `${base} ${n}`;
	}

	const now = new Date();
	const id = crypto.randomUUID();
	const [created] = await db
		.insert(view)
		.values({
			id,
			projectId,
			name,
			type,
			config: '{}',
			position: now.getTime(),
			createdBy: actor!.id,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(created);
}

/* -------------------------------- duplicate ------------------------------- */

/**
 * Duplicate a view (copies type + config; name → "<name> copy[ N]"). Gated by project
 * canEditProject; the source view must belong to `projectId`. Mirrors duplicateView form
 * action + POST /api/projects/[id]/views (duplicate branch).
 */
export async function duplicateView(
	projectId: string,
	sourceViewId: string,
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<ViewRow>> {
	const [proj] = await db.select({ id: project.id }).from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	if (!sourceViewId) return err(400, 'duplicateViewId must be a non-empty string');
	const [src] = await db.select().from(view).where(eq(view.id, sourceViewId));
	if (!src || src.projectId !== projectId) return err(400, 'Invalid view');

	const existing = await db
		.select({ name: view.name })
		.from(view)
		.where(eq(view.projectId, projectId));
	let name = `${src.name} copy`;
	for (let n = 2; existing.some((x) => x.name === name); n++) name = `${src.name} copy ${n}`;

	const now = new Date();
	const newId = crypto.randomUUID();
	const [created] = await db
		.insert(view)
		.values({
			id: newId,
			projectId,
			name,
			type: src.type,
			config: src.config,
			position: src.position + 1,
			createdBy: actor!.id,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(created);
}

/* --------------------------------- update --------------------------------- */

export type UpdateViewInput = {
	name?: string;
	/** Schemaless JSON — a string or an object; stored as a string. */
	config?: unknown;
	hidden?: boolean;
};

/**
 * Patch a view (only keys in `has` are touched: name/config/hidden). Gated by the view's
 * project access + canEditView (404-before-403 per ADR-019) OR a form-action `owner` scope
 * (the URL project, existence → 400). Type is fixed at creation. Hiding a view (or any
 * state that would leave 0 visible) is rejected. Mirrors updateView / hideView / unhideView
 * form actions + PATCH /api/views/[id].
 */
export async function updateViewById(
	id: string,
	input: UpdateViewInput,
	actor: Actor,
	opts: {
		has: (key: keyof UpdateViewInput) => boolean;
		broadcast?: boolean;
		/** Form-action ownership assertion: the view must belong to this project. */
		owner?: { projectId: string };
	}
): Promise<ServiceResult<ViewRow>> {
	const [v] = await db.select().from(view).where(eq(view.id, id));
	if (!v) {
		if (opts.owner) return err(400, 'Invalid view');
		return err(404, 'View not found');
	}

	if (opts.owner) {
		if (v.projectId !== opts.owner.projectId) return err(400, 'Invalid view');
		if (!(await canEditView(actor, id))) return err(403, 'No edit permission on this view');
	} else {
		if (!(await canAccessProject(actor, v.projectId))) return err(404, 'View not found');
		if (!(await canEditView(actor, id))) return err(403, 'No edit permission on this view');
	}

	const updates: Partial<typeof view.$inferInsert> = {};

	if (opts.has('name')) {
		const name = (input.name ?? '').trim();
		if (!name) return err(400, 'View name is required');
		if (name.length > 120) return err(400, 'name too long (max 120)');
		updates.name = name;
	}

	if (opts.has('config')) {
		let parsed: unknown;
		if (typeof input.config === 'string') {
			try {
				parsed = JSON.parse(input.config);
			} catch {
				return err(400, 'Invalid view config');
			}
		} else {
			parsed = input.config;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return err(400, 'Invalid view config');
		updates.config = JSON.stringify(parsed);
	}

	if (opts.has('hidden')) {
		if (typeof input.hidden !== 'boolean') return err(400, 'hidden must be a boolean');
		if (input.hidden && !v.hidden) {
			const visible = await db
				.select({ id: view.id })
				.from(view)
				.where(and(eq(view.projectId, v.projectId), eq(view.hidden, false)));
			if (visible.length <= 1) return err(400, 'A project must keep at least one view');
		}
		updates.hidden = input.hidden;
	}

	if (Object.keys(updates).length === 0) return err(400, 'No fields to update');

	const [updated] = await db
		.update(view)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(view.id, id))
		.returning();

	if (opts.broadcast) broadcastProjectChange(v.projectId, actor!.id);
	return ok(updated);
}

/* --------------------------------- reorder -------------------------------- */

/**
 * Reorder a project's views from an ordered id list (positions = i*10). The set must
 * reference only this project's views; edit rights are checked via canEditView(ids[0]).
 * Mirrors reorderView form action + PATCH /api/projects/[id]/views.
 */
export async function reorderViews(
	projectId: string,
	ids: string[],
	actor: Actor,
	opts: { broadcast?: boolean; requireEditProject?: boolean; invalidOrderMessage?: string } = {}
): Promise<ServiceResult<ViewRow[]>> {
	// REST collection PATCH gates on project access + canEditProject first.
	if (opts.requireEditProject) {
		const [proj] = await db
			.select({ id: project.id })
			.from(project)
			.where(eq(project.id, projectId));
		if (!proj) return err(404, 'Project not found');
		if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
		if (!(await canEditProject(actor, projectId)))
			return err(403, 'No edit permission on this project');
	}

	const rows = await db.select({ id: view.id }).from(view).where(eq(view.projectId, projectId));
	const projectIds = new Set(rows.map((r) => r.id));
	if (!ids.length || !ids.every((id) => projectIds.has(id)))
		return err(400, opts.invalidOrderMessage ?? 'Invalid order');

	if (!opts.requireEditProject) {
		if (!(await canEditView(actor, ids[0]))) return err(403, 'No edit permission on this view');
	}

	for (let i = 0; i < ids.length; i++)
		await db
			.update(view)
			.set({ position: i * 10, updatedAt: new Date() })
			.where(eq(view.id, ids[i]));

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(
		await db
			.select()
			.from(view)
			.where(eq(view.projectId, projectId))
			.orderBy(asc(view.position), asc(view.createdAt))
	);
}

/* --------------------------------- delete --------------------------------- */

/**
 * Delete a view by id. Gated by the view's project access + canEditView (404-before-403)
 * OR a form-action `owner` scope (existence → 400). A project must keep ≥1 visible view
 * (a hidden view may be removed). Mirrors deleteView form action + DELETE /api/views/[id].
 */
export async function deleteViewById(
	id: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } } = {}
): Promise<ServiceResult<null>> {
	const [v] = await db.select().from(view).where(eq(view.id, id));
	if (!v) {
		if (opts.owner) return err(400, 'Invalid view');
		return err(404, 'View not found');
	}

	if (opts.owner) {
		if (v.projectId !== opts.owner.projectId) return err(400, 'Invalid view');
		if (!(await canEditView(actor, id))) return err(403, 'No edit permission on this view');
	} else {
		if (!(await canAccessProject(actor, v.projectId))) return err(404, 'View not found');
		if (!(await canEditView(actor, id))) return err(403, 'No edit permission on this view');
	}

	// A project must keep at least one visible view (a hidden view may be removed).
	const visible = await db
		.select({ id: view.id })
		.from(view)
		.where(and(eq(view.projectId, v.projectId), eq(view.hidden, false)));
	if (!v.hidden && visible.length <= 1) return err(400, 'A project must keep at least one view');

	await db.delete(view).where(eq(view.id, id));
	if (opts.broadcast) broadcastProjectChange(v.projectId, actor!.id);
	return ok(null);
}
