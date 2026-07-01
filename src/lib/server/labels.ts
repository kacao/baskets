import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from './db';
import { label, labelGroup, project, projectLabel } from './db/schema';
import { parseIconValue } from '$lib/server/icons';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import {
	canAccessProject,
	canAccessWorkspace,
	canEditProject,
	canEditWorkspace
} from '$lib/server/permissions';

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

type LabelRow = typeof label.$inferSelect;
type LabelGroupRow = typeof labelGroup.$inferSelect;

/**
 * A label is workspace-scoped (workspaceId) OR project-scoped (projectId).
 * Gate accordingly: 404 if the caller can't access the owner, else 403 if
 * they can't edit it. Returns null on success.
 */
async function guardLabel(actor: Actor, row: LabelRow): Promise<ServiceResult<never> | null> {
	if (row.projectId) {
		if (!(await canAccessProject(actor, row.projectId))) return err(404, 'Label not found');
		if (!(await canEditProject(actor, row.projectId)))
			return err(403, 'No edit permission on this label');
	} else if (row.workspaceId) {
		if (!(await canAccessWorkspace(actor, row.workspaceId))) return err(404, 'Label not found');
		if (!(await canEditWorkspace(actor, row.workspaceId)))
			return err(403, 'No edit permission on this label');
	} else {
		return err(404, 'Label not found');
	}
	return null;
}

/* --------------------------------- create --------------------------------- */

export type CreateLabelInput = {
	name: string;
	color?: unknown;
	icon?: unknown;
	/** Workspace scope only: optional group membership. */
	groupId?: string | null;
};

/**
 * Create a label under a project OR a workspace. Preserves per-owner name
 * uniqueness, color/icon parsing, and (project scope) the realtime broadcast.
 */
export async function createLabel(
	scope: { type: 'project'; id: string } | { type: 'workspace'; id: string },
	input: CreateLabelInput,
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<LabelRow>> {
	if (scope.type === 'project') {
		const [proj] = await db.select().from(project).where(eq(project.id, scope.id));
		if (!proj) return err(404, 'Project not found');
		if (!(await canAccessProject(actor, scope.id))) return err(404, 'Project not found');
		if (!(await canEditProject(actor, scope.id)))
			return err(403, 'No edit permission on this project');

		const name = input.name.trim();
		if (!name) return err(400, 'Label name is required');
		if (name.length > 40) return err(400, 'Name too long (max 40)');

		const existing = await db
			.select({ name: label.name })
			.from(label)
			.where(eq(label.projectId, scope.id));
		if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
			return err(400, 'A label with that name exists');

		const [created] = await db
			.insert(label)
			.values({
				id: crypto.randomUUID(),
				name,
				projectId: scope.id,
				color: parseColor(input.color),
				icon: parseIconValue(input.icon),
				position: Date.now(),
				createdAt: new Date()
			})
			.returning();
		if (opts.broadcast) broadcastProjectChange(scope.id, actor!.id);
		return ok(created);
	}

	// workspace scope
	if (!(await canAccessWorkspace(actor, scope.id))) return err(404, 'Workspace not found');
	if (!(await canEditWorkspace(actor, scope.id)))
		return err(403, 'No edit permission on this workspace');

	const name = input.name.trim();
	if (!name) return err(400, 'Label name is required');
	if (name.length > 40) return err(400, 'Name too long (max 40)');

	const existing = await db
		.select({ name: label.name })
		.from(label)
		.where(eq(label.workspaceId, scope.id));
	if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
		return err(400, 'A label with that name exists');

	let groupId: string | null = null;
	if (input.groupId !== undefined && input.groupId !== null && input.groupId !== '') {
		if (typeof input.groupId !== 'string') return err(400, 'groupId must be a string or null');
		const [g] = await db.select().from(labelGroup).where(eq(labelGroup.id, input.groupId));
		if (!g || g.workspaceId !== scope.id) return err(400, 'Unknown group');
		groupId = input.groupId;
	}

	const [created] = await db
		.insert(label)
		.values({
			id: crypto.randomUUID(),
			name,
			workspaceId: scope.id,
			groupId,
			color: parseColor(input.color),
			icon: parseIconValue(input.icon),
			position: Date.now(),
			createdAt: new Date()
		})
		.returning();
	return ok(created);
}

/* --------------------------------- update --------------------------------- */

export type UpdateLabelInput = { name?: string; color?: unknown; icon?: unknown };

/**
 * Patch a label by id (name/color/icon; only keys in `has` are touched). Gates by
 * the label's own owner (project or workspace) per ADR-019. Mirrors updateLabel /
 * updateProjectLabel form actions + PATCH /api/labels/[id].
 */
export async function updateLabelById(
	id: string,
	input: UpdateLabelInput,
	actor: Actor,
	opts: {
		has: (key: keyof UpdateLabelInput) => boolean;
		broadcast?: boolean;
		/** Form-action ownership assertion: the label must belong to this scope. */
		owner?: { projectId: string } | { workspaceId: string };
		/** Form actions silently succeed on an empty patch (REST returns 400). */
		emptyOk?: boolean;
	}
): Promise<ServiceResult<LabelRow | null>> {
	const [existing] = await db.select().from(label).where(eq(label.id, id));
	if (!existing) {
		if (opts.owner) return err(400, 'Unknown label');
		return err(404, 'Label not found');
	}

	// Form-action scope assertion (keyed to the URL owner).
	if (opts.owner) {
		if ('projectId' in opts.owner && existing.projectId !== opts.owner.projectId)
			return err(400, 'Unknown label');
		if ('workspaceId' in opts.owner && existing.workspaceId !== opts.owner.workspaceId)
			return err(400, 'Unknown label');
	} else {
		const denied = await guardLabel(actor, existing);
		if (denied) return denied;
	}

	const updates: Partial<typeof label.$inferInsert> = {};
	if (opts.has('name')) {
		const name = (input.name ?? '').trim();
		if (!name) return err(400, 'Label name is required');
		if (name.length > 40) return err(400, 'Name too long (max 40)');
		// uniqueness is scoped to the label's owner (workspace OR project)
		const scopeWhere = existing.projectId
			? eq(label.projectId, existing.projectId)
			: eq(label.workspaceId, existing.workspaceId as string);
		const others = await db
			.select({ id: label.id, name: label.name })
			.from(label)
			.where(and(scopeWhere, ne(label.id, id)));
		if (others.some((l) => l.name.toLowerCase() === name.toLowerCase()))
			return err(400, 'A label with that name exists');
		updates.name = name;
	}
	if (opts.has('color')) updates.color = parseColor(input.color);
	if (opts.has('icon')) updates.icon = parseIconValue(input.icon);

	if (Object.keys(updates).length === 0) {
		// Form actions silently succeed on an empty patch; REST returns 400.
		if (opts.emptyOk) return ok(existing);
		return err(400, 'No fields to update');
	}

	const [updated] = await db.update(label).set(updates).where(eq(label.id, id)).returning();
	if (opts.broadcast && existing.projectId) broadcastProjectChange(existing.projectId, actor!.id);
	return ok(updated);
}

/* --------------------------------- delete --------------------------------- */

/**
 * Delete a label by id. Gates by the label's own owner per ADR-019 (REST), OR by a
 * form-action `owner` scope (deleteLabel / deleteProjectLabel — a no-op if the id
 * doesn't belong to the URL owner, matching the form actions' `and(...)` delete).
 */
export async function deleteLabelById(
	id: string,
	actor: Actor,
	opts: { broadcast?: boolean; owner?: { projectId: string } | { workspaceId: string } } = {}
): Promise<ServiceResult<null>> {
	if (opts.owner) {
		if ('projectId' in opts.owner)
			await db.delete(label).where(and(eq(label.id, id), eq(label.projectId, opts.owner.projectId)));
		else
			await db
				.delete(label)
				.where(and(eq(label.id, id), eq(label.workspaceId, opts.owner.workspaceId)));
		return ok(null);
	}

	const [existing] = await db.select().from(label).where(eq(label.id, id));
	if (!existing) return err(404, 'Label not found');
	const denied = await guardLabel(actor, existing);
	if (denied) return denied;

	await db.delete(label).where(eq(label.id, id));
	if (opts.broadcast && existing.projectId) broadcastProjectChange(existing.projectId, actor!.id);
	return ok(null);
}

/* --------------------------- project label toggle -------------------------- */

/**
 * Toggle a WORKSPACE label onto/off a project via project_label. Mirrors the
 * toggleProjectLabel form action + PUT/PATCH /api/projects/[id]/labels.
 */
export async function toggleProjectLabel(
	projectId: string,
	labelId: string,
	actor: Actor,
	opts: { broadcast?: boolean } = {}
): Promise<ServiceResult<{ labelId: string; attached: boolean }>> {
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) return err(404, 'Project not found');
	if (!(await canAccessProject(actor, projectId))) return err(404, 'Project not found');
	if (!(await canEditProject(actor, projectId)))
		return err(403, 'No edit permission on this project');

	if (!labelId) return err(400, 'labelId is required');

	const [has] = await db
		.select()
		.from(projectLabel)
		.where(and(eq(projectLabel.projectId, projectId), eq(projectLabel.labelId, labelId)));

	let attached: boolean;
	if (has) {
		await db
			.delete(projectLabel)
			.where(and(eq(projectLabel.projectId, projectId), eq(projectLabel.labelId, labelId)));
		attached = false;
	} else {
		const [l] = await db.select().from(label).where(eq(label.id, labelId));
		if (!l || l.workspaceId !== proj.workspaceId) return err(400, 'Unknown label');
		await db.insert(projectLabel).values({ projectId, labelId });
		attached = true;
	}

	if (opts.broadcast) broadcastProjectChange(projectId, actor!.id);
	return ok({ labelId, attached });
}

/* ------------------------------- label groups ------------------------------ */

/** Create a workspace label group (mirrors createGroup + POST /workspaces/[id]/label-groups). */
export async function createLabelGroup(
	workspaceId: string,
	name: string,
	actor: Actor
): Promise<ServiceResult<LabelGroupRow>> {
	if (!(await canAccessWorkspace(actor, workspaceId))) return err(404, 'Workspace not found');
	if (!(await canEditWorkspace(actor, workspaceId)))
		return err(403, 'No edit permission on this workspace');

	const trimmed = name.trim();
	if (!trimmed) return err(400, 'Group name is required');
	if (trimmed.length > 40) return err(400, 'Name too long (max 40)');

	const existing = await db
		.select({ name: labelGroup.name })
		.from(labelGroup)
		.where(eq(labelGroup.workspaceId, workspaceId));
	if (existing.some((g) => g.name.toLowerCase() === trimmed.toLowerCase()))
		return err(400, 'A group with that name exists');

	const [created] = await db
		.insert(labelGroup)
		.values({
			id: crypto.randomUUID(),
			name: trimmed,
			workspaceId,
			position: Date.now(),
			createdAt: new Date()
		})
		.returning();
	return ok(created);
}

/**
 * Delete a label group. Labels in the group survive (groupId set null via FK).
 * Gates by the group's own workspace per ADR-019 (REST), OR by a form-action
 * `workspaceId` scope (a scoped no-op delete, matching deleteGroup).
 */
export async function deleteLabelGroupById(
	id: string,
	actor: Actor,
	opts: { workspaceId?: string } = {}
): Promise<ServiceResult<null>> {
	if (opts.workspaceId) {
		await db
			.delete(labelGroup)
			.where(and(eq(labelGroup.id, id), eq(labelGroup.workspaceId, opts.workspaceId)));
		return ok(null);
	}

	const [existing] = await db.select().from(labelGroup).where(eq(labelGroup.id, id));
	if (!existing) return err(404, 'Group not found');
	const wsId = existing.workspaceId;
	if (!wsId || !(await canAccessWorkspace(actor, wsId))) return err(404, 'Group not found');
	if (!(await canEditWorkspace(actor, wsId)))
		return err(403, 'No edit permission on this workspace');

	await db.delete(labelGroup).where(eq(labelGroup.id, id));
	return ok(null);
}
