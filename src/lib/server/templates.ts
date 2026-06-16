// Task templates (BASDEV-8). A template stores a JSON payload describing a task
// and its sub-tasks (plus custom-field values), scoped to a project or its
// workspace, so it can be re-instantiated as fresh tasks later.
//
// Payload shape (versionless, schemaless-friendly):
//   {
//     task: { title, description?, priority?, recurrence?, fields?: {<fieldId>: <raw>} },
//     subtasks?: [{ title, description?, priority?, fields?: {<fieldId>: <raw>} }]
//   }
//
// instantiateTemplate creates real rows: a top-level task + each sub-task, with
// custom-field values applied where the field still belongs to the target
// project. Statuses default to the project's backlog (or first eligible) status.

import { asc, eq, inArray, or } from 'drizzle-orm';
import { db } from './db';
import { project, task, taskCustomValue, template } from './db/schema';
import { writeTaskCustomValues } from './customFields';
import { listProjectStatuses } from './statuses';

export type TemplateTaskPayload = {
	title: string;
	description?: string | null;
	priority?: string;
	recurrence?: string | null;
	fields?: Record<string, string | null>;
};

export type TemplatePayload = {
	task: TemplateTaskPayload;
	subtasks?: TemplateTaskPayload[];
};

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

function normalizePriority(p: unknown): string {
	const v = typeof p === 'string' ? p : 'none';
	return (PRIORITIES as readonly string[]).includes(v) ? v : 'none';
}

function fieldEntries(fields?: Record<string, string | null>) {
	if (!fields) return [];
	return Object.entries(fields).map(([fieldId, raw]) => ({ fieldId, raw }));
}

/** Templates available to a project: its own + its workspace's. Newest first. */
export async function listTemplatesForProject(projectId: string) {
	const [proj] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, projectId));
	const scopeFilter = proj?.workspaceId
		? or(eq(template.projectId, projectId), eq(template.workspaceId, proj.workspaceId))
		: eq(template.projectId, projectId);
	return db.select().from(template).where(scopeFilter).orderBy(asc(template.name));
}

export async function getTemplate(id: string) {
	const [t] = await db.select().from(template).where(eq(template.id, id));
	return t ?? null;
}

/** Create a template row. scope 'workspace' stores workspaceId; 'project' stores projectId. */
export async function createTemplate(opts: {
	name: string;
	scope: 'workspace' | 'project';
	projectId: string;
	workspaceId: string | null;
	payload: TemplatePayload;
	createdBy: string;
}) {
	const id = crypto.randomUUID();
	await db.insert(template).values({
		id,
		name: opts.name,
		scope: opts.scope,
		projectId: opts.scope === 'project' ? opts.projectId : null,
		workspaceId: opts.scope === 'workspace' ? opts.workspaceId : null,
		payload: JSON.stringify(opts.payload),
		createdBy: opts.createdBy,
		createdAt: new Date()
	});
	return id;
}

export async function deleteTemplate(id: string) {
	await db.delete(template).where(eq(template.id, id));
}

/**
 * Overwrite an existing template's payload (and optionally name) from a task.
 * Scope-checked: the template must be reachable from `projectId` (same project
 * or its workspace, mirroring listTemplatesForProject) — returns the updated
 * row's scope/workspaceId for the caller to gate workspace edits, or null if
 * the template is unknown or out of scope.
 */
export async function updateTemplatePayload(
	id: string,
	projectId: string,
	payload: TemplatePayload,
	name?: string
): Promise<{ scope: string; workspaceId: string | null } | null> {
	const tpl = await getTemplate(id);
	if (!tpl) return null;
	const [proj] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, projectId));
	const inScope =
		tpl.projectId === projectId || (!!tpl.workspaceId && tpl.workspaceId === proj?.workspaceId);
	if (!inScope) return null;
	const set: { payload: string; name?: string } = { payload: JSON.stringify(payload) };
	if (name && name.trim()) set.name = name.trim().slice(0, 120);
	await db.update(template).set(set).where(eq(template.id, id));
	return { scope: tpl.scope, workspaceId: tpl.workspaceId };
}

/**
 * Build a template payload from an existing task and its sub-tasks. `cfValues`
 * is the set of (taskId, fieldId, value) rows used to capture field values.
 */
export function buildPayloadFromTask(
	parent: typeof task.$inferSelect,
	subtasks: (typeof task.$inferSelect)[],
	cfValues: { taskId: string; fieldId: string; value: string }[]
): TemplatePayload {
	const fieldsFor = (taskId: string): Record<string, string> | undefined => {
		const rows = cfValues.filter((v) => v.taskId === taskId);
		if (rows.length === 0) return undefined;
		return Object.fromEntries(rows.map((r) => [r.fieldId, r.value]));
	};
	const toPayload = (t: typeof task.$inferSelect): TemplateTaskPayload => ({
		title: t.title,
		description: t.description,
		priority: t.priority,
		recurrence: t.recurrence,
		fields: fieldsFor(t.id)
	});
	return {
		task: toPayload(parent),
		subtasks: subtasks.map(toPayload)
	};
}

/**
 * Create real task(s) from a template into `projectId`. Returns the new
 * top-level task id, or null if the template is unusable. Caller is responsible
 * for access checks and for broadcasting the project change.
 */
export async function instantiateTemplate(
	templateId: string,
	projectId: string,
	userId: string
): Promise<string | null> {
	const tpl = await getTemplate(templateId);
	if (!tpl) return null;

	// Scope check: a template may only be instantiated into a project it belongs
	// to, or into a project in the same workspace (mirrors listTemplatesForProject).
	const [targetProject] = await db
		.select({ workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, projectId));
	if (!targetProject) return null;
	const inScope =
		tpl.projectId === projectId ||
		(!!tpl.workspaceId && tpl.workspaceId === targetProject.workspaceId);
	if (!inScope) return null;

	let payload: TemplatePayload;
	try {
		payload = JSON.parse(tpl.payload) as TemplatePayload;
	} catch {
		return null;
	}
	if (!payload?.task?.title) return null;

	const statuses = await listProjectStatuses(projectId);
	const defaultStatus = statuses.find((s) => s.category === 'backlog') ?? statuses[0];
	if (!defaultStatus) return null;

	const now = new Date();
	const parentId = crypto.randomUUID();

	// Atomic via manual compensation: better-sqlite3 transactions are synchronous and
	// cannot wrap the async writeTaskCustomValues, so on any failure we delete every
	// row created so far (tasks + their custom values) and surface null — no partial tree.
	const createdIds: string[] = [parentId];
	try {
		await db.insert(task).values({
			id: parentId,
			projectId,
			parentId: null,
			title: payload.task.title.slice(0, 240),
			description: payload.task.description ?? null,
			priority: normalizePriority(payload.task.priority),
			recurrence: payload.task.recurrence ?? null,
			statusId: defaultStatus.id,
			createdBy: userId,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});
		const parentValues = await writeTaskCustomValues(
			parentId,
			projectId,
			fieldEntries(payload.task.fields)
		);
		if (parentValues.error) throw new Error(parentValues.error);

		const subtasks = Array.isArray(payload.subtasks) ? payload.subtasks : [];
		for (let i = 0; i < subtasks.length; i++) {
			const sub = subtasks[i];
			if (!sub?.title) continue;
			const subId = crypto.randomUUID();
			createdIds.push(subId);
			await db.insert(task).values({
				id: subId,
				projectId,
				parentId,
				title: sub.title.slice(0, 240),
				description: sub.description ?? null,
				priority: normalizePriority(sub.priority),
				statusId: defaultStatus.id,
				createdBy: userId,
				position: now.getTime() + i + 1,
				createdAt: now,
				updatedAt: now
			});
			const subValues = await writeTaskCustomValues(subId, projectId, fieldEntries(sub.fields));
			if (subValues.error) throw new Error(subValues.error);
		}
	} catch (err) {
		console.error('instantiateTemplate: rolling back partial tree', err);
		await db.delete(taskCustomValue).where(inArray(taskCustomValue.taskId, createdIds));
		await db.delete(task).where(inArray(task.id, createdIds));
		return null;
	}

	return parentId;
}
