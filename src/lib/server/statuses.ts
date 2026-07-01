import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db';
import { project, projectStatus, status, task } from './db/schema';
import { STATUS_CATEGORIES, type StatusCategory } from '$lib/statuses';
import { parseIconValue } from '$lib/server/icons';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import {
	canAccessProject,
	canAccessWorkspace,
	canEditProject,
	canEditWorkspace,
	isAdmin
} from '$lib/server/permissions';

export { STATUS_CATEGORIES, type StatusCategory };

/* -------------------------- shared service scaffolding -------------------------- */

/** The acting user; carries `role` so permission checks can honor admin bypass. */
export type Actor = { id: string; role?: string | null } | null | undefined;

export type ServiceResult<T> =
	| { ok: true; data: T }
	| { ok: false; status: number; message: string };

const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
const err = (status: number, message: string): ServiceResult<never> => ({ ok: false, status, message });

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

const DEFAULT_STATUSES: {
	id: string;
	name: string;
	category: StatusCategory;
	color: string;
	icon: string;
}[] = [
	{ id: 'status-backlog', name: 'Backlog', category: 'backlog', color: '#71717a', icon: 'iconoir:circle' },
	{ id: 'status-planned', name: 'Planned', category: 'planned', color: '#3b82f6', icon: 'iconoir:clock' },
	{ id: 'status-in-progress', name: 'In progress', category: 'in-progress', color: '#f59e0b', icon: 'iconoir:half-moon' },
	{ id: 'status-completed', name: 'Completed', category: 'completed', color: '#16a34a', icon: 'iconoir:check-circle' },
	{ id: 'status-canceled', name: 'Canceled', category: 'canceled', color: '#a1a1aa', icon: 'iconoir:xmark-circle' }
];

let ensured = false;

/** Idempotent bootstrap: guarantees the five built-in statuses exist (with colors). */
export async function ensureDefaultStatuses() {
	if (ensured) return;
	const existing = await db
		.select({
			id: status.id,
			name: status.name,
			category: status.category,
			color: status.color,
			icon: status.icon
		})
		.from(status);
	const have = new Map(existing.map((s) => [s.id, s]));
	const now = new Date();
	const missing = DEFAULT_STATUSES.filter((s) => !have.has(s.id));
	if (missing.length > 0) {
		await db.insert(status).values(
			missing.map((s) => ({
				...s,
				position: DEFAULT_STATUSES.indexOf(s) * 10,
				builtIn: true,
				createdAt: now
			}))
		);
	}
	// reconcile name/category/color/icon on pre-existing built-ins (migrates older
	// rows: 4-category set + missing default icons)
	for (const s of DEFAULT_STATUSES) {
		const row = have.get(s.id);
		if (
			row &&
			(row.name !== s.name ||
				row.category !== s.category ||
				row.color !== s.color ||
				(!row.icon && s.icon))
		)
			await db
				.update(status)
				.set({ name: s.name, category: s.category, color: s.color, icon: row.icon || s.icon })
				.where(eq(status.id, s.id));
	}
	ensured = true;
}

/**
 * App-wide default statuses: the five built-ins. Fixed — no add/edit/remove
 * (custom statuses live on a workspace or a project).
 */
export async function listStatuses() {
	return db
		.select()
		.from(status)
		.where(and(isNull(status.projectId), isNull(status.workspaceId)))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses owned by one workspace. */
export async function listWorkspaceStatuses(workspaceId: string) {
	return db
		.select()
		.from(status)
		.where(eq(status.workspaceId, workspaceId))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses owned by one project. */
export async function listProjectCustomStatuses(projectId: string) {
	return db
		.select()
		.from(status)
		.where(eq(status.projectId, projectId))
		.orderBy(asc(status.position), asc(status.createdAt));
}

/** Statuses a project allows, in global order. Falls back to all if none configured. */
export async function listProjectStatuses(projectId: string) {
	const rows = await db
		.select({ status })
		.from(projectStatus)
		.innerJoin(status, eq(projectStatus.statusId, status.id))
		.where(eq(projectStatus.projectId, projectId))
		.orderBy(asc(status.position), asc(status.createdAt));

	if (rows.length > 0) return rows.map((r) => r.status);
	return listStatuses();
}

/* -------------------------------- status CRUD -------------------------------- */

type StatusRow = typeof status.$inferSelect;

/** Defaults + the project's workspace statuses + its own statuses are assignable/name-taken here. */
async function assignableStatuses(projectId: string) {
	const [proj] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, projectId));
	const [defaults, wsStatuses, customs] = await Promise.all([
		listStatuses(),
		proj?.workspaceId ? listWorkspaceStatuses(proj.workspaceId) : Promise.resolve([]),
		listProjectCustomStatuses(projectId)
	]);
	return [...defaults, ...wsStatuses, ...customs];
}

/** Names a new/renamed workspace status must not collide with: defaults,
 * workspace siblings, AND statuses owned by this workspace's projects. */
async function workspaceTakenStatusNames(workspaceId: string) {
	const projectIds = (
		await db.select({ id: project.id }).from(project).where(eq(project.workspaceId, workspaceId))
	).map((p) => p.id);
	const projectStatuses =
		projectIds.length > 0
			? await db.select().from(status).where(inArray(status.projectId, projectIds))
			: [];
	return [
		...(await listStatuses()),
		...(await listWorkspaceStatuses(workspaceId)),
		...projectStatuses
	];
}

export type CreateStatusInput = {
	name: string;
	description?: string | null;
	category?: string;
	color?: unknown;
	icon?: unknown;
};

/** Create a PROJECT-scoped status (mirrors createStatus form action + POST /projects/[id]/statuses). */
export async function createProjectStatus(
	projectId: string,
	input: CreateStatusInput,
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<StatusRow>> {
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	const name = input.name.trim();
	const description =
		typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null;
	const category = input.category ?? 'backlog';

	if (!name) return err(400, 'Status name is required');
	if (name.length > 40) return err(400, 'Name too long (max 40)');
	if (description && description.length > 200) return err(400, 'Description too long (max 200)');
	if (!STATUS_CATEGORIES.includes(category as StatusCategory)) return err(400, 'Invalid category');

	const color = parseColor(input.color);
	const icon = parseIconValue(input.icon);

	const taken = await assignableStatuses(projectId);
	if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
		return err(400, 'A status with that name already exists here');

	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(status).values({
		id,
		name,
		description,
		category,
		color,
		icon,
		projectId,
		position: (taken.at(-1)?.position ?? 0) + 10,
		builtIn: false,
		createdAt: now
	});
	// project statuses are eligible in their project by definition
	await db.insert(projectStatus).values({ projectId, statusId: id });

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	const [created] = await db.select().from(status).where(eq(status.id, id));
	return ok(created);
}

/** Create a WORKSPACE-scoped status (mirrors createStatus form action + POST /workspaces/[id]/statuses). */
export async function createWorkspaceStatus(
	workspaceId: string,
	input: CreateStatusInput,
	actor: Actor
): Promise<ServiceResult<StatusRow>> {
	if (!(await canAccessWorkspace(actor, workspaceId))) return err(404, 'Workspace not found');
	if (!(await canEditWorkspace(actor, workspaceId)))
		return err(403, 'No edit permission on this workspace');

	const name = input.name.trim();
	const description =
		typeof input.description === 'string' && input.description.trim() ? input.description.trim() : null;
	const category = input.category ?? 'backlog';

	if (!name) return err(400, 'Status name is required');
	if (name.length > 40) return err(400, 'Name too long (max 40)');
	if (description && description.length > 200) return err(400, 'Description too long (max 200)');
	if (!STATUS_CATEGORIES.includes(category as StatusCategory)) return err(400, 'Invalid category');

	const color = parseColor(input.color);
	const icon = parseIconValue(input.icon);

	const taken = await workspaceTakenStatusNames(workspaceId);
	if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
		return err(400, 'A status with that name already exists here');

	const [created] = await db
		.insert(status)
		.values({
			id: crypto.randomUUID(),
			name,
			description,
			category,
			color,
			icon,
			workspaceId,
			position: (taken.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: new Date()
		})
		.returning();
	return ok(created);
}

/**
 * A partial status patch: only keys PRESENT in `has` are changed. Handles a
 * project-scoped OR workspace-scoped status (gated by the row's own owner), AND
 * the app-wide built-in default (icon-only, admin-only — REST PATCH /statuses/[id]).
 */
export type UpdateStatusInput = {
	name?: string;
	description?: string | null;
	category?: string;
	color?: unknown;
	icon?: unknown;
};

export async function updateStatusById(
	id: string,
	input: UpdateStatusInput,
	actor: Actor,
	opts: {
		has: (key: keyof UpdateStatusInput) => boolean;
		broadcast?: boolean;
		/** Form-action ownership assertion: the status must belong to this scope. */
		owner?: { projectId: string } | { workspaceId: string };
	}
): Promise<ServiceResult<StatusRow>> {
	const [s] = await db.select().from(status).where(eq(status.id, id));
	if (!s) {
		if (opts.owner)
			return err(400, `Not a status of this ${'projectId' in opts.owner ? 'project' : 'workspace'}`);
		return err(404, 'Status not found');
	}

	// Form-action scope assertion (keyed to the URL owner, not the row's own scope).
	if (opts.owner) {
		if ('projectId' in opts.owner && s.projectId !== opts.owner.projectId)
			return err(400, 'Not a status of this project');
		if ('workspaceId' in opts.owner && s.workspaceId !== opts.owner.workspaceId)
			return err(400, 'Not a status of this workspace');
	}

	// Built-in app-wide default (projectId + workspaceId both null): only the icon
	// is settable, admin-only (mirror setStatusIcon / PATCH built-in branch).
	if (!s.projectId && !s.workspaceId) {
		if (!isAdmin(actor)) return err(403, 'Admins only');
		const icon = parseIconValue(input.icon);
		if (!icon) return err(400, 'Pick an icon');
		const [updated] = await db.update(status).set({ icon }).where(eq(status.id, id)).returning();
		return ok(updated);
	}

	// Custom status: gate by its scope (404-before-403).
	if (s.projectId) {
		if (!(await canAccessProject(actor, s.projectId))) return err(404, 'Status not found');
		if (!(await canEditProject(actor, s.projectId)))
			return err(403, 'No edit permission on this project');
	} else {
		if (!(await canAccessWorkspace(actor, s.workspaceId!))) return err(404, 'Status not found');
		if (!(await canEditWorkspace(actor, s.workspaceId!)))
			return err(403, 'No edit permission on this workspace');
	}

	const updates: Partial<typeof status.$inferInsert> = {};
	const takenLazy = async () =>
		s.projectId ? assignableStatuses(s.projectId) : workspaceTakenStatusNames(s.workspaceId!);

	if (opts.has('name')) {
		const name = (input.name ?? '').trim();
		if (!name) return err(400, 'Status name is required');
		if (name.length > 40) return err(400, 'Name too long (max 40)');
		const taken = await takenLazy();
		if (taken.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase()))
			return err(400, 'A status with that name already exists here');
		updates.name = name;
	}
	if (opts.has('description')) {
		const description =
			typeof input.description === 'string' && input.description.trim()
				? input.description.trim()
				: null;
		if (description && description.length > 200) return err(400, 'Description too long (max 200)');
		updates.description = description;
	}
	if (opts.has('category')) {
		const category = input.category ?? '';
		if (!STATUS_CATEGORIES.includes(category as StatusCategory)) return err(400, 'Invalid category');
		updates.category = category;
	}
	if (opts.has('color')) updates.color = parseColor(input.color);
	if (opts.has('icon')) updates.icon = parseIconValue(input.icon);

	if (Object.keys(updates).length === 0) return err(400, 'No fields to update');

	const [updated] = await db.update(status).set(updates).where(eq(status.id, id)).returning();
	if (opts.broadcast && s.projectId) broadcastProjectChange(s.projectId, actor!.id);
	return ok(updated);
}

/**
 * Delete a status by id. Refuses built-in defaults, gates by scope, and refuses a
 * status still used by tasks. Mirrors both deleteStatus form actions + DELETE REST.
 */
export async function deleteStatusById(
	id: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } | { workspaceId: string } } = {}
): Promise<ServiceResult<null>> {
	const [s] = await db.select().from(status).where(eq(status.id, id));
	if (!s) {
		if (opts.owner)
			return err(400, `Not a status of this ${'projectId' in opts.owner ? 'project' : 'workspace'}`);
		return err(404, 'Status not found');
	}

	// Form-action scope assertion (keyed to the URL owner).
	if (opts.owner) {
		if ('projectId' in opts.owner && s.projectId !== opts.owner.projectId)
			return err(400, 'Not a status of this project');
		if ('workspaceId' in opts.owner && s.workspaceId !== opts.owner.workspaceId)
			return err(400, 'Not a status of this workspace');
	}

	// Built-in defaults cannot be deleted.
	if (!s.projectId && !s.workspaceId) return err(400, 'Built-in statuses cannot be deleted');

	if (s.projectId) {
		if (!(await canAccessProject(actor, s.projectId))) return err(404, 'Status not found');
		if (!(await canEditProject(actor, s.projectId)))
			return err(403, 'No edit permission on this project');
	} else {
		if (!(await canAccessWorkspace(actor, s.workspaceId!))) return err(404, 'Status not found');
		if (!(await canEditWorkspace(actor, s.workspaceId!)))
			return err(403, 'No edit permission on this workspace');
	}

	const [{ n }] = await db.select({ n: count(task.id) }).from(task).where(eq(task.statusId, id));
	if (n > 0) return err(400, `Status is used by ${n} task(s)`);

	await db.delete(status).where(eq(status.id, id));
	if (opts.broadcast && s.projectId) broadcastProjectChange(s.projectId, actor!.id);
	return ok(null);
}

/** Reorder a PROJECT's custom statuses (positions only), keeping them after inherited rows. */
export async function reorderProjectStatuses(
	projectId: string,
	ids: string[],
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<StatusRow[]>> {
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	const clean = ids.map((s) => s.trim()).filter(Boolean);
	const owned = await listProjectCustomStatuses(projectId);
	const ownedIds = new Set(owned.map((s) => s.id));
	if (clean.length !== owned.length || !clean.every((id) => ownedIds.has(id)))
		return err(400, 'Invalid order');

	const inherited = [
		...(await listStatuses()),
		...(proj.workspaceId ? await listWorkspaceStatuses(proj.workspaceId) : [])
	];
	// keep project customs sorted after defaults + workspace statuses globally
	const base = Math.max(0, ...inherited.map((s) => s.position)) + 10;
	for (let i = 0; i < clean.length; i++)
		await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, clean[i]));

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(await listProjectStatuses(projectId));
}

/** Reorder a WORKSPACE's custom statuses (positions only), keeping them after built-ins. */
export async function reorderWorkspaceStatuses(
	workspaceId: string,
	ids: string[],
	actor: Actor,
	opts: { invalidOrderMessage?: string } = {}
): Promise<ServiceResult<StatusRow[]>> {
	if (!(await canAccessWorkspace(actor, workspaceId))) return err(404, 'Workspace not found');
	if (!(await canEditWorkspace(actor, workspaceId)))
		return err(403, 'No edit permission on this workspace');

	const clean = ids.map((s) => s.trim()).filter(Boolean);
	const owned = await listWorkspaceStatuses(workspaceId);
	const ownedIds = new Set(owned.map((s) => s.id));
	if (clean.length !== owned.length || !clean.every((id) => ownedIds.has(id)))
		return err(400, opts.invalidOrderMessage ?? 'Invalid order');

	// keep customs sorted after the built-in defaults globally
	const base = Math.max(0, ...(await listStatuses()).map((d) => d.position)) + 10;
	for (let i = 0; i < clean.length; i++)
		await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, clean[i]));

	return ok(await listWorkspaceStatuses(workspaceId));
}

/**
 * Set a project's eligible status id set (mirrors updateProjectStatuses action +
 * the PATCH /projects/[id]/statuses `statusIds` branch).
 */
export async function setProjectEligibleStatuses(
	projectId: string,
	statusIds: string[],
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<StatusRow[]>> {
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	const clean = statusIds.map((s) => s.trim()).filter(Boolean);
	if (clean.length === 0) return err(400, 'A project needs at least one eligible status');

	const valid = new Set((await assignableStatuses(projectId)).map((s) => s.id));
	if (!clean.every((id) => valid.has(id))) return err(400, 'Unknown status');

	const inUse = await db
		.select({ statusId: task.statusId })
		.from(task)
		.where(eq(task.projectId, projectId));
	const keep = new Set(clean);
	if (inUse.some((t) => !keep.has(t.statusId)))
		return err(400, 'Cannot remove a status still used by tasks in this project');

	await db.delete(projectStatus).where(eq(projectStatus.projectId, projectId));
	await db.insert(projectStatus).values(clean.map((statusId) => ({ projectId, statusId })));

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok(await listProjectStatuses(projectId));
}

/** Set a built-in app-wide default status's icon (admin-only). Mirrors setStatusIcon action. */
export async function setDefaultStatusIcon(
	id: string,
	icon: unknown,
	actor: Actor
): Promise<ServiceResult<StatusRow>> {
	if (!isAdmin(actor)) return err(403, 'Admins only');
	const parsed = parseIconValue(icon);
	if (!parsed) return err(400, 'Pick an icon');

	// must be an app-wide built-in default (projectId + workspaceId both null)
	const [s] = await db
		.select()
		.from(status)
		.where(and(eq(status.id, id), isNull(status.projectId), isNull(status.workspaceId)));
	if (!s) return err(400, 'Not a default status');

	const [updated] = await db.update(status).set({ icon: parsed }).where(eq(status.id, id)).returning();
	return ok(updated);
}
