import { asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
	customField,
	customFieldOption,
	label,
	location,
	milestone,
	project,
	projectStatus,
	status,
	task,
	taskCustomValue
} from './db/schema';
import { createProjectWithDefaults } from './projects';
import {
	listProjectStatuses,
	listProjectCustomStatuses,
	listStatuses,
	listWorkspaceStatuses
} from './statuses';
import { listProjectCustomFields } from './customFields';
import { decodeValue, MULTI_CAPABLE } from '$lib/customFields';
import { INITIAL_CATEGORY } from '$lib/statuses';

/** A portable, id-stable snapshot of a project (version 1). Assignees, people,
 *  files (bytes + person/files cf values), attachments, dependencies, views and
 *  grants are intentionally NOT included — they aren't portable. */
export type ProjectExport = {
	version: 1;
	project: {
		name: string;
		description: string | null;
		icon: string | null;
		statusDisplay: string;
		startDate: string | null;
		dueDate: string | null;
	};
	statuses: {
		id: string;
		name: string;
		category: string;
		color: string | null;
		icon: string | null;
		description: string | null;
		position: number;
	}[];
	milestones: {
		id: string;
		name: string;
		startDate: string | null;
		targetDate: string | null;
		position: number;
	}[];
	locations: {
		id: string;
		title: string;
		address: string | null;
		latitude: number | null;
		longitude: number | null;
		position: number;
	}[];
	labels: { id: string; name: string; color: string | null; icon: string | null }[];
	customFields: {
		id: string;
		entity: string;
		name: string;
		type: string;
		config: string;
		appliesTo: string;
		position: number;
		options: {
			id: string;
			title: string;
			color: string | null;
			icon: string | null;
			position: number;
		}[];
	}[];
	tasks: {
		id: string;
		parentId: string | null;
		title: string;
		description: string | null;
		statusName: string | null;
		priority: string;
		milestoneId: string | null;
		locationId: string | null;
		locationText: string | null;
		startDate: string | null;
		dueDate: string | null;
		order: number | null;
		position: number;
		customValues: { fieldId: string; value: string }[];
	}[];
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Serialize a project into a portable JSON document (real DB ids as stable keys). */
export async function buildProjectExport(projectId: string): Promise<ProjectExport> {
	const [proj] = await db.select().from(project).where(eq(project.id, projectId));
	if (!proj) throw new Error('Project not found');

	const [tasks, milestones, locations, allStatuses, customStatuses, labels, customFields] =
		await Promise.all([
			db
				.select()
				.from(task)
				.where(eq(task.projectId, projectId))
				.orderBy(asc(task.position), asc(task.createdAt)),
			db
				.select()
				.from(milestone)
				.where(eq(milestone.projectId, projectId))
				.orderBy(asc(milestone.position), asc(milestone.createdAt)),
			db
				.select()
				.from(location)
				.where(eq(location.projectId, projectId))
				.orderBy(asc(location.position), asc(location.title)),
			listProjectStatuses(projectId),
			listProjectCustomStatuses(projectId),
			db
				.select()
				.from(label)
				.where(eq(label.projectId, projectId))
				.orderBy(asc(label.position), asc(label.name)),
			listProjectCustomFields(projectId)
		]);

	const statusName = new Map(
		(allStatuses as { id: string; name: string }[]).map((s) => [s.id, s.name])
	);

	const fieldIds = customFields.map((f) => f.id);
	const taskIds = tasks.map((t) => t.id);
	const [optionRows, valueRows] = await Promise.all([
		fieldIds.length
			? db.select().from(customFieldOption).where(inArray(customFieldOption.fieldId, fieldIds))
			: Promise.resolve([] as (typeof customFieldOption.$inferSelect)[]),
		taskIds.length
			? db.select().from(taskCustomValue).where(inArray(taskCustomValue.taskId, taskIds))
			: Promise.resolve([] as (typeof taskCustomValue.$inferSelect)[])
	]);

	const optionsByField = new Map<string, ProjectExport['customFields'][number]['options']>();
	for (const o of optionRows.sort((a, b) => a.position - b.position)) {
		const arr = optionsByField.get(o.fieldId) ?? [];
		arr.push({ id: o.id, title: o.title, color: o.color, icon: o.icon, position: o.position });
		optionsByField.set(o.fieldId, arr);
	}

	const valuesByTask = new Map<string, { fieldId: string; value: string }[]>();
	for (const r of valueRows) {
		const arr = valuesByTask.get(r.taskId) ?? [];
		arr.push({ fieldId: r.fieldId, value: r.value });
		valuesByTask.set(r.taskId, arr);
	}

	return {
		version: 1,
		project: {
			name: proj.name,
			description: proj.description,
			icon: proj.icon,
			statusDisplay: proj.statusDisplay,
			startDate: iso(proj.startDate),
			dueDate: iso(proj.dueDate)
		},
		statuses: customStatuses.map((s) => ({
			id: s.id,
			name: s.name,
			category: s.category,
			color: s.color,
			icon: s.icon,
			description: s.description,
			position: s.position
		})),
		milestones: milestones.map((m) => ({
			id: m.id,
			name: m.name,
			startDate: iso(m.startDate),
			targetDate: iso(m.targetDate),
			position: m.position
		})),
		locations: locations.map((l) => ({
			id: l.id,
			title: l.title,
			address: l.address,
			latitude: l.latitude,
			longitude: l.longitude,
			position: l.position
		})),
		labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color, icon: l.icon })),
		customFields: customFields.map((f) => ({
			id: f.id,
			entity: f.entity,
			name: f.name,
			type: f.type,
			config: JSON.stringify(f.config),
			appliesTo: f.appliesTo,
			position: f.position,
			options: optionsByField.get(f.id) ?? []
		})),
		tasks: tasks.map((t) => ({
			id: t.id,
			parentId: t.parentId,
			title: t.title,
			description: t.description,
			statusName: t.statusId ? (statusName.get(t.statusId) ?? null) : null,
			priority: t.priority,
			milestoneId: t.milestoneId,
			locationId: t.locationId,
			locationText: t.location,
			startDate: iso(t.startDate),
			dueDate: iso(t.dueDate),
			order: t.order,
			position: t.position,
			customValues: valuesByTask.get(t.id) ?? []
		}))
	};
}

const asDate = (v: string | null | undefined) => (v ? new Date(v) : null);

function assert(cond: unknown, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

/** Recreate a project from an export document under a new id-space. Returns the
 *  new project id. Throws a friendly Error on malformed input. */
export async function importProjectFromExport(
	doc: unknown,
	opts: { workspaceId: string; creator: { id: string; role?: string | null } }
): Promise<string> {
	assert(doc && typeof doc === 'object', 'Invalid file: not an object');
	const d = doc as Partial<ProjectExport>;
	assert(d.version === 1, 'Unsupported export version');
	assert(d.project && typeof d.project === 'object', 'Invalid file: missing project');
	assert(
		typeof d.project.name === 'string' && d.project.name.trim(),
		'Invalid file: missing project name'
	);

	const statuses = Array.isArray(d.statuses) ? d.statuses : [];
	const milestones = Array.isArray(d.milestones) ? d.milestones : [];
	const locations = Array.isArray(d.locations) ? d.locations : [];
	const labels = Array.isArray(d.labels) ? d.labels : [];
	const customFields = Array.isArray(d.customFields) ? d.customFields : [];
	const tasks = Array.isArray(d.tasks) ? d.tasks : [];

	const newId = await createProjectWithDefaults({
		name: d.project.name.trim() + ' (imported)',
		description: d.project.description ?? null,
		workspaceId: opts.workspaceId,
		creator: opts.creator
	});

	const now = new Date();
	await db
		.update(project)
		.set({
			icon: d.project.icon ?? null,
			statusDisplay: ['text', 'icon', 'text-icon'].includes(d.project.statusDisplay ?? '')
				? (d.project.statusDisplay as string)
				: 'text',
			startDate: asDate(d.project.startDate),
			dueDate: asDate(d.project.dueDate),
			updatedAt: now
		})
		.where(eq(project.id, newId));

	// 3. Project-scoped statuses → new ids + eligibility. statusByName resolves a
	// task's stored status name across imported customs AND the new project's
	// assignable defaults/workspace statuses.
	const statusByName = new Map<string, string>();
	const [defaults, wsStatuses] = await Promise.all([
		listStatuses(),
		listWorkspaceStatuses(opts.workspaceId)
	]);
	for (const s of [...defaults, ...wsStatuses]) statusByName.set(s.name.toLowerCase(), s.id);

	let pos = Math.max(0, ...[...defaults, ...wsStatuses].map((s) => s.position)) + 10;
	for (const s of statuses) {
		const id = crypto.randomUUID();
		await db.insert(status).values({
			id,
			name: s.name,
			description: s.description ?? null,
			category: s.category,
			color: s.color ?? null,
			icon: s.icon ?? null,
			projectId: newId,
			position: pos,
			builtIn: false,
			createdAt: now
		});
		await db.insert(projectStatus).values({ projectId: newId, statusId: id });
		statusByName.set(s.name.toLowerCase(), id);
		pos += 10;
	}

	// Fallback status: the new project's INITIAL_CATEGORY (backlog) status.
	const assignable = await listProjectStatuses(newId);
	const fallbackStatusId =
		assignable.find((s) => s.category === INITIAL_CATEGORY)?.id ?? assignable[0]?.id;
	assert(fallbackStatusId, 'No assignable status for the new project');

	// 4. Milestones
	const milestoneIdMap = new Map<string, string>();
	for (const m of milestones) {
		const id = crypto.randomUUID();
		await db.insert(milestone).values({
			id,
			projectId: newId,
			name: m.name,
			startDate: asDate(m.startDate),
			targetDate: asDate(m.targetDate),
			position: m.position ?? 0,
			createdAt: now,
			updatedAt: now
		});
		milestoneIdMap.set(m.id, id);
	}

	// 5. Locations
	const locationIdMap = new Map<string, string>();
	for (const l of locations) {
		const id = crypto.randomUUID();
		await db.insert(location).values({
			id,
			projectId: newId,
			title: l.title,
			address: l.address ?? null,
			latitude: l.latitude ?? null,
			longitude: l.longitude ?? null,
			position: l.position ?? 0,
			createdAt: now,
			updatedAt: now
		});
		locationIdMap.set(l.id, id);
	}

	// 6. Project-scoped labels (recreated; task_label links dropped for v1)
	for (const l of labels) {
		await db.insert(label).values({
			id: crypto.randomUUID(),
			name: l.name,
			projectId: newId,
			color: l.color ?? null,
			icon: l.icon ?? null,
			position: Date.now(),
			createdAt: now
		});
	}

	// 7. Custom fields + options
	const fieldIdMap = new Map<string, string>();
	const fieldTypeByNew = new Map<string, string>();
	const optionIdMap = new Map<string, string>();
	for (const f of customFields) {
		const id = crypto.randomUUID();
		await db.insert(customField).values({
			id,
			projectId: newId,
			entity: f.entity === 'project' ? 'project' : 'task',
			name: f.name,
			type: f.type,
			config: typeof f.config === 'string' ? f.config : '{}',
			appliesTo: f.appliesTo ?? 'all',
			position: f.position ?? 0,
			createdAt: now
		});
		fieldIdMap.set(f.id, id);
		fieldTypeByNew.set(id, f.type);
		for (const o of f.options ?? []) {
			const oid = crypto.randomUUID();
			await db.insert(customFieldOption).values({
				id: oid,
				fieldId: id,
				title: o.title,
				color: o.color ?? null,
				icon: o.icon ?? null,
				position: o.position ?? 0,
				createdAt: now
			});
			optionIdMap.set(o.id, oid);
		}
	}

	// 8. Tasks — pass 1: insert as top-level (parent remap in pass 2).
	const taskIdMap = new Map<string, string>();
	const reparent: { newId: string; oldParentId: string }[] = [];
	for (const t of tasks) {
		const id = crypto.randomUUID();
		const statusId =
			(t.statusName && statusByName.get(t.statusName.toLowerCase())) || fallbackStatusId;
		await db.insert(task).values({
			id,
			projectId: newId,
			parentId: null,
			title: t.title,
			description: t.description ?? null,
			statusId,
			priority: t.priority ?? 'none',
			assigneeId: null,
			milestoneId: t.milestoneId ? (milestoneIdMap.get(t.milestoneId) ?? null) : null,
			locationId: t.locationId ? (locationIdMap.get(t.locationId) ?? null) : null,
			location: t.locationText ?? null,
			order: t.order ?? null,
			position: t.position ?? 0,
			startDate: asDate(t.startDate),
			dueDate: asDate(t.dueDate),
			createdBy: opts.creator.id,
			createdAt: now,
			updatedAt: now
		});
		taskIdMap.set(t.id, id);
		if (t.parentId) reparent.push({ newId: id, oldParentId: t.parentId });
	}

	// pass 2: re-parent (only top-level→child nesting that resolved)
	for (const r of reparent) {
		const parent = taskIdMap.get(r.oldParentId);
		if (parent) await db.update(task).set({ parentId: parent }).where(eq(task.id, r.newId));
	}

	// 9. Custom values — remap reference ids; drop person/files (not portable).
	for (const t of tasks) {
		const newTaskId = taskIdMap.get(t.id);
		if (!newTaskId) continue;
		for (const cv of t.customValues ?? []) {
			const newFieldId = fieldIdMap.get(cv.fieldId);
			if (!newFieldId) continue;
			const type = fieldTypeByNew.get(newFieldId) ?? '';
			if (type === 'person' || type === 'files') continue;

			let value: string;
			if (MULTI_CAPABLE.has(type)) {
				const decoded = decodeValue({ type }, cv.value);
				const ids = Array.isArray(decoded) ? (decoded as string[]) : [];
				const remapped = ids
					.map((oldId) => {
						if (type === 'select') return optionIdMap.get(oldId);
						if (type === 'place') return locationIdMap.get(oldId);
						if (type === 'task') return taskIdMap.get(oldId);
						return undefined;
					})
					.filter((x): x is string => Boolean(x));
				if (remapped.length === 0) continue;
				value = JSON.stringify(remapped);
			} else {
				if (cv.value == null || cv.value === '') continue;
				value = cv.value;
			}
			await db.insert(taskCustomValue).values({ taskId: newTaskId, fieldId: newFieldId, value });
		}
	}

	return newId;
}
