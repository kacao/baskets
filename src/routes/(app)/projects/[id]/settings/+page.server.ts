import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	customField,
	customFieldOption,
	label,
	location,
	milestone,
	permission,
	project,
	projectDependency,
	projectLabel,
	projectStatus,
	status,
	task,
	taskCustomValue,
	user,
	view
} from '$lib/server/db/schema';
import {
	accessibleWorkspaceIds,
	canEditProject,
	grantedProjectIds,
	isAdmin,
	listProjectGrants
} from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { parseIconValue } from '$lib/server/icons';
import {
	listProjectCustomStatuses,
	listStatuses,
	listWorkspaceStatuses,
	STATUS_CATEGORIES,
	type StatusCategory
} from '$lib/server/statuses';
import {
	APPLIES_TO,
	CUSTOM_FIELD_TYPES,
	isCustomFieldType,
	listCustomFieldOptions,
	listProjectCustomFields,
	listProjectCustomValues,
	writeProjectCustomValues,
	validateFieldConfig
} from '$lib/server/customFields';
import { deleteFilesForField } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Defaults + the project's workspace statuses + its own statuses are assignable here. */
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

/** Accept a #rrggbb hex color, else null. */
function parseColor(v: FormDataEntryValue | null): string | null {
	const s = String(v ?? '').trim();
	return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

/** Resolve a select option only if its field belongs to this project. */
async function optionInProject(optionId: string, projectId: string) {
	const [row] = await db
		.select({ id: customFieldOption.id, fieldId: customFieldOption.fieldId })
		.from(customFieldOption)
		.innerJoin(customField, eq(customFieldOption.fieldId, customField.id))
		.where(and(eq(customFieldOption.id, optionId), eq(customField.projectId, projectId)));
	return row ?? null;
}

/** Parse the optional latitude/longitude form fields (blank ⇒ null), range-checked. */
function parseCoords(form: FormData): { lat: number | null; lng: number | null } | { error: string } {
	const latRaw = String(form.get('latitude') ?? '').trim();
	const lngRaw = String(form.get('longitude') ?? '').trim();
	let lat: number | null = null;
	let lng: number | null = null;
	if (latRaw !== '') {
		lat = Number(latRaw);
		if (!Number.isFinite(lat) || lat < -90 || lat > 90)
			return { error: 'Latitude must be between -90 and 90' };
	}
	if (lngRaw !== '') {
		lng = Number(lngRaw);
		if (!Number.isFinite(lng) || lng < -180 || lng > 180)
			return { error: 'Longitude must be between -180 and 180' };
	}
	return { lat, lng };
}

function createsCycle(edges: Map<string, string[]>, from: string, to: string) {
	const stack = [to];
	const seen = new Set<string>();
	while (stack.length) {
		const cur = stack.pop()!;
		if (cur === from) return true;
		if (seen.has(cur)) continue;
		seen.add(cur);
		for (const next of edges.get(cur) ?? []) stack.push(next);
	}
	return false;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) error(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		error(403, 'No edit permission on this project');

	const [
		globalStatuses,
		workspaceStatuses,
		customStatuses,
		eligible,
		labels,
		projLabels,
		projectScopedLabels,
		projDeps,
		allProjects,
		milestones,
		users,
		views,
		statusUsage
	] = await Promise.all([
		listStatuses(),
		proj.workspaceId ? listWorkspaceStatuses(proj.workspaceId) : Promise.resolve([]),
		listProjectCustomStatuses(params.id),
		db.select().from(projectStatus).where(eq(projectStatus.projectId, params.id)),
		proj.workspaceId
			? db
					.select()
					.from(label)
					.where(eq(label.workspaceId, proj.workspaceId))
					.orderBy(asc(label.position), asc(label.name))
			: Promise.resolve([]),
		db.select().from(projectLabel).where(eq(projectLabel.projectId, params.id)),
		db
			.select()
			.from(label)
			.where(eq(label.projectId, params.id))
			.orderBy(asc(label.position), asc(label.name)),
		db.select().from(projectDependency).where(eq(projectDependency.projectId, params.id)),
		db
			.select({ id: project.id, name: project.name, workspaceId: project.workspaceId })
			.from(project)
			.orderBy(asc(project.name)),
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db.select({ id: user.id, name: user.name }).from(user).orderBy(asc(user.name)),
		db
			.select({ id: view.id, name: view.name, type: view.type })
			.from(view)
			.where(eq(view.projectId, params.id))
			.orderBy(asc(view.position)),
		db
			.select({ statusId: task.statusId, n: count(task.id) })
			.from(task)
			.where(eq(task.projectId, params.id))
			.groupBy(task.statusId)
	]);

	const locations = await db
		.select()
		.from(location)
		.where(eq(location.projectId, params.id))
		.orderBy(asc(location.position), asc(location.title));

	const customFields = await listProjectCustomFields(params.id);
	const [customFieldOptions, cfUsage, projectCustomValues] = await Promise.all([
		listCustomFieldOptions(customFields.map((f) => f.id)),
		db
			.select({ fieldId: taskCustomValue.fieldId, n: count() })
			.from(taskCustomValue)
			.innerJoin(task, eq(taskCustomValue.taskId, task.id))
			.where(eq(task.projectId, params.id))
			.groupBy(taskCustomValue.fieldId),
		listProjectCustomValues(params.id)
	]);

	const admin = isAdmin(locals.user);

	// ADR-019: dependency picker offers only accessible projects (existing deps stay listed)
	const [wsAccess, projGrants] = await Promise.all([
		accessibleWorkspaceIds(locals.user),
		grantedProjectIds(locals.user)
	]);
	const visibleProjects =
		wsAccess === 'all'
			? allProjects
			: allProjects.filter(
					(p) =>
						(p.workspaceId && wsAccess.has(p.workspaceId)) ||
						projGrants.has(p.id) ||
						projDeps.some((d) => d.dependsOnId === p.id)
				);

	return {
		project: proj,
		globalStatuses,
		workspaceStatuses,
		customStatuses: customStatuses.map((s) => ({
			...s,
			inUse: statusUsage.find((u) => u.statusId === s.id)?.n ?? 0
		})),
		eligibleStatusIds: eligible.map((e) => e.statusId),
		categories: STATUS_CATEGORIES,
		labels,
		projectLabelIds: projLabels.map((l) => l.labelId),
		projectScopedLabels,
		projectDependsOn: projDeps.map((d) => d.dependsOnId),
		allProjects: visibleProjects,
		milestones,
		locations,
		customFields: customFields.map((f) => ({
			...f,
			inUse: cfUsage.find((u) => u.fieldId === f.id)?.n ?? 0
		})),
		customFieldOptions,
		projectCustomValues,
		fieldTypes: CUSTOM_FIELD_TYPES,
		users,
		views,
		grants: admin ? await listProjectGrants(params.id) : [],
		perm: { admin }
	};
};

export const actions: Actions = {
	/** Budget (BASDEV-10): pick which number custom fields back estimated/actual cost. */
	setBudgetFields: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const estRaw = String(form.get('estimatedCostFieldId') ?? '').trim() || null;
		const actRaw = String(form.get('actualCostFieldId') ?? '').trim() || null;

		const validate = async (id: string | null) => {
			if (!id) return true;
			const [f] = await db
				.select({ id: customField.id, type: customField.type })
				.from(customField)
				.where(and(eq(customField.id, id), eq(customField.projectId, params.id)));
			return !!f && f.type === 'number';
		};
		if (!(await validate(estRaw)))
			return fail(400, { message: 'Estimated cost field must be a number field of this project' });
		if (!(await validate(actRaw)))
			return fail(400, { message: 'Actual cost field must be a number field of this project' });

		await db
			.update(project)
			.set({ estimatedCostFieldId: estRaw, actualCostFieldId: actRaw, updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	updateProject: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Project name is required' });

		await db
			.update(project)
			.set({ name, description: description || null, updatedAt: new Date() })
			.where(eq(project.id, params.id));

		return { success: true };
	},

	setStatusDisplay: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const value = String((await request.formData()).get('statusDisplay') ?? '');
		if (!['text', 'icon', 'text-icon'].includes(value))
			return fail(400, { message: 'Invalid status display' });

		await db
			.update(project)
			.set({ statusDisplay: value, updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await db.delete(project).where(eq(project.id, params.id));
		redirect(303, '/projects');
	},

	/* ----------------------- project-scoped statuses ----------------------- */

	createStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const category = String(form.get('category') ?? 'backlog');

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (description && description.length > 200) return fail(400, { message: 'Description too long (max 200)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const color = parseColor(form.get('color'));
		const icon = parseIconValue(form.get('icon'));

		const taken = await assignableStatuses(params.id);
		if (taken.some((s) => s.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		const id = crypto.randomUUID();
		const now = new Date();
		await db.insert(status).values({
			id,
			name,
			description,
			category,
			color,
			icon,
			projectId: params.id,
			position: (taken.at(-1)?.position ?? 0) + 10,
			builtIn: false,
			createdAt: now
		});
		// project statuses are eligible in their project by definition
		await db.insert(projectStatus).values({ projectId: params.id, statusId: id });

		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const category = String(form.get('category') ?? 'backlog');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.projectId !== params.id)
			return fail(400, { message: 'Not a status of this project' });

		if (!name) return fail(400, { message: 'Status name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		if (description && description.length > 200) return fail(400, { message: 'Description too long (max 200)' });
		if (!STATUS_CATEGORIES.includes(category as StatusCategory))
			return fail(400, { message: 'Invalid category' });

		const color = parseColor(form.get('color'));
		const icon = parseIconValue(form.get('icon'));

		const taken = await assignableStatuses(params.id);
		if (taken.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A status with that name already exists here' });

		await db.update(status).set({ name, description, category, color, icon }).where(eq(status.id, id));
		return { success: true };
	},

	deleteStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');

		const [s] = await db.select().from(status).where(eq(status.id, id));
		if (!s || s.projectId !== params.id)
			return fail(400, { message: 'Not a status of this project' });

		const [{ n }] = await db
			.select({ n: count(task.id) })
			.from(task)
			.where(eq(task.statusId, id));
		if (n > 0) return fail(400, { message: `Status is used by ${n} task(s)` });

		await db.delete(status).where(eq(status.id, id));
		return { success: true };
	},

	/** Reorder this project's custom statuses (positions only; category unchanged). */
	reorderStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const owned = await listProjectCustomStatuses(params.id);
		const ownedIds = new Set(owned.map((s) => s.id));
		if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id)))
			return fail(400, { message: 'Invalid order' });

		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, params.id));
		const inherited = [
			...(await listStatuses()),
			...(proj?.workspaceId ? await listWorkspaceStatuses(proj.workspaceId) : [])
		];
		// keep project customs sorted after defaults + workspace statuses globally
		const base = Math.max(0, ...inherited.map((s) => s.position)) + 10;
		for (let i = 0; i < ids.length; i++)
			await db.update(status).set({ position: base + i * 10 }).where(eq(status.id, ids[i]));
		return { success: true };
	},

	updateProjectStatuses: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const statusIds = form.getAll('statusIds').map(String).filter(Boolean);
		if (statusIds.length === 0)
			return fail(400, { message: 'A project needs at least one eligible status' });

		const valid = new Set((await assignableStatuses(params.id)).map((s) => s.id));
		if (!statusIds.every((id) => valid.has(id))) return fail(400, { message: 'Unknown status' });

		const inUse = await db
			.select({ statusId: task.statusId })
			.from(task)
			.where(eq(task.projectId, params.id));
		const keep = new Set(statusIds);
		if (inUse.some((t) => !keep.has(t.statusId)))
			return fail(400, { message: 'Cannot remove a status still used by tasks in this project' });

		await db.delete(projectStatus).where(eq(projectStatus.projectId, params.id));
		await db
			.insert(projectStatus)
			.values(statusIds.map((statusId) => ({ projectId: params.id, statusId })));
		return { success: true };
	},

	/* --------------------------- custom fields --------------------------- */

	createCustomField: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? '');

		if (!name) return fail(400, { message: 'Field name is required' });
		if (name.length > 60) return fail(400, { message: 'Name too long (max 60)' });
		if (!isCustomFieldType(type)) return fail(400, { message: 'Invalid field type' });
		const appliesTo = String(form.get('appliesTo') ?? 'all');
		if (!APPLIES_TO.includes(appliesTo as (typeof APPLIES_TO)[number]))
			return fail(400, { message: 'Invalid “applies to”' });
		const entity = String(form.get('entity') ?? 'task') === 'project' ? 'project' : 'task';

		const existing = await db
			.select({ name: customField.name, position: customField.position })
			.from(customField)
			.where(eq(customField.projectId, params.id))
			.orderBy(asc(customField.position));
		if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A field with that name already exists' });

		await db.insert(customField).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			entity,
			name,
			type,
			config: validateFieldConfig(type, String(form.get('config') ?? '{}')),
			appliesTo,
			position: (existing.at(-1)?.position ?? 0) + 10,
			createdAt: new Date()
		});
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	// Set the project's own (entity='project') custom-field values from a pill form
	// (posts `id` = projectId + `cf_<fieldId>` fields, like patchTask but project-scoped).
	patchProjectCustomValues: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const entries: { fieldId: string; raw: string | null }[] = [];
		for (const [k, v] of form.entries()) {
			if (k.startsWith('cf_')) entries.push({ fieldId: k.slice(3), raw: String(v) });
		}
		if (entries.length) {
			const res = await writeProjectCustomValues(params.id, entries);
			if (res.error) return fail(400, { message: res.error });
		}
		return { success: true };
	},

	// Name + config only — type is immutable after creation (values are type-encoded).
	updateCustomField: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const name = String(form.get('name') ?? '').trim();

		const [f] = await db
			.select()
			.from(customField)
			.where(and(eq(customField.id, id), eq(customField.projectId, params.id)));
		if (!f) return fail(400, { message: 'Not a field of this project' });

		if (!name) return fail(400, { message: 'Field name is required' });
		if (name.length > 60) return fail(400, { message: 'Name too long (max 60)' });

		const others = await db
			.select({ id: customField.id, name: customField.name })
			.from(customField)
			.where(eq(customField.projectId, params.id));
		if (others.some((o) => o.id !== id && o.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A field with that name already exists' });

		const config = form.has('config') ? validateFieldConfig(f.type, String(form.get('config'))) : f.config;
		const set: { name: string; config: string; appliesTo?: string } = { name, config };
		if (form.has('appliesTo')) {
			const appliesTo = String(form.get('appliesTo'));
			if (!APPLIES_TO.includes(appliesTo as (typeof APPLIES_TO)[number]))
				return fail(400, { message: 'Invalid “applies to”' });
			set.appliesTo = appliesTo;
		}
		await db.update(customField).set(set).where(eq(customField.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteCustomField: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const [f] = await db
			.select({ id: customField.id, type: customField.type })
			.from(customField)
			.where(and(eq(customField.id, id), eq(customField.projectId, params.id)));
		if (!f) return fail(400, { message: 'Not a field of this project' });

		// FK cascade removes its options + task values; for files-type, also unlink
		// the bytes on disk + their rows (FK only nulls file.fieldId otherwise).
		if (f.type === 'files') await deleteFilesForField(id);
		await db.delete(customField).where(eq(customField.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	reorderCustomField: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const owned = await db
			.select({ id: customField.id })
			.from(customField)
			.where(eq(customField.projectId, params.id));
		const ownedIds = new Set(owned.map((f) => f.id));
		if (ids.length !== owned.length || !ids.every((i) => ownedIds.has(i)))
			return fail(400, { message: 'Invalid order' });

		for (let i = 0; i < ids.length; i++)
			await db.update(customField).set({ position: i * 10 }).where(eq(customField.id, ids[i]));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* --------------------- custom field select options --------------------- */

	createCustomFieldOption: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const fieldId = String(form.get('fieldId') ?? '');
		const title = String(form.get('title') ?? '').trim();

		const [f] = await db
			.select()
			.from(customField)
			.where(and(eq(customField.id, fieldId), eq(customField.projectId, params.id)));
		if (!f || f.type !== 'select') return fail(400, { message: 'Not a select field of this project' });
		if (!title) return fail(400, { message: 'Option title is required' });
		if (title.length > 60) return fail(400, { message: 'Title too long (max 60)' });

		const opts = await db
			.select({ position: customFieldOption.position })
			.from(customFieldOption)
			.where(eq(customFieldOption.fieldId, fieldId))
			.orderBy(asc(customFieldOption.position));
		await db.insert(customFieldOption).values({
			id: crypto.randomUUID(),
			fieldId,
			title,
			color: parseColor(form.get('color')),
			icon: parseIconValue(form.get('icon')),
			position: (opts.at(-1)?.position ?? 0) + 10,
			createdAt: new Date()
		});
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	updateCustomFieldOption: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();

		const opt = await optionInProject(id, params.id);
		if (!opt) return fail(400, { message: 'Not an option of this project' });
		if (!title) return fail(400, { message: 'Option title is required' });
		if (title.length > 60) return fail(400, { message: 'Title too long (max 60)' });

		await db
			.update(customFieldOption)
			.set({ title, color: parseColor(form.get('color')), icon: parseIconValue(form.get('icon')) })
			.where(eq(customFieldOption.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteCustomFieldOption: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const opt = await optionInProject(id, params.id);
		if (!opt) return fail(400, { message: 'Not an option of this project' });

		// strip this optionId from every value array of its field before deleting
		const rows = await db
			.select()
			.from(taskCustomValue)
			.where(eq(taskCustomValue.fieldId, opt.fieldId));
		for (const r of rows) {
			let ids: string[] = [];
			try {
				const v = JSON.parse(r.value);
				if (Array.isArray(v)) ids = v.map(String);
			} catch {
				continue;
			}
			if (!ids.includes(id)) continue;
			const next = ids.filter((x) => x !== id);
			if (next.length === 0)
				await db
					.delete(taskCustomValue)
					.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
			else
				await db
					.update(taskCustomValue)
					.set({ value: JSON.stringify(next) })
					.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
		}
		await db.delete(customFieldOption).where(eq(customFieldOption.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	reorderCustomFieldOption: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const fieldId = String(form.get('fieldId') ?? '');
		const ids = String(form.get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const [f] = await db
			.select({ id: customField.id })
			.from(customField)
			.where(and(eq(customField.id, fieldId), eq(customField.projectId, params.id)));
		if (!f) return fail(400, { message: 'Not a field of this project' });

		const owned = await db
			.select({ id: customFieldOption.id })
			.from(customFieldOption)
			.where(eq(customFieldOption.fieldId, fieldId));
		const ownedIds = new Set(owned.map((o) => o.id));
		if (ids.length !== owned.length || !ids.every((i) => ownedIds.has(i)))
			return fail(400, { message: 'Invalid order' });

		for (let i = 0; i < ids.length; i++)
			await db.update(customFieldOption).set({ position: i * 10 }).where(eq(customFieldOption.id, ids[i]));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ------------------------------- labels ------------------------------- */

	toggleProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const labelId = String(form.get('labelId') ?? '');

		const [has] = await db
			.select()
			.from(projectLabel)
			.where(and(eq(projectLabel.projectId, params.id), eq(projectLabel.labelId, labelId)));
		if (has) {
			await db
				.delete(projectLabel)
				.where(and(eq(projectLabel.projectId, params.id), eq(projectLabel.labelId, labelId)));
		} else {
			const [l] = await db.select().from(label).where(eq(label.id, labelId));
			const [proj] = await db.select().from(project).where(eq(project.id, params.id));
			if (!l || !proj || l.workspaceId !== proj.workspaceId)
				return fail(400, { message: 'Unknown label' });
			await db.insert(projectLabel).values({ projectId: params.id, labelId });
		}
		return { success: true };
	},

	// Project-scoped labels: owned by this project (label.projectId), always
	// available to its tasks — distinct from toggling shared workspace labels.
	createProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'Label name is required' });
		if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
		const existing = await db
			.select({ name: label.name })
			.from(label)
			.where(eq(label.projectId, params.id));
		if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase()))
			return fail(400, { message: 'A label with that name exists' });

		await db.insert(label).values({
			id: crypto.randomUUID(),
			name,
			projectId: params.id,
			color: parseColor(form.get('color')),
			icon: parseIconValue(form.get('icon')),
			position: Date.now(),
			createdAt: new Date()
		});
		return { success: true };
	},

	updateProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const [existing] = await db.select().from(label).where(eq(label.id, id));
		if (!existing || existing.projectId !== params.id)
			return fail(400, { message: 'Unknown label' });

		const set: Partial<typeof label.$inferInsert> = {};
		if (form.has('name')) {
			const name = String(form.get('name') ?? '').trim();
			if (!name) return fail(400, { message: 'Label name is required' });
			if (name.length > 40) return fail(400, { message: 'Name too long (max 40)' });
			const others = await db
				.select({ id: label.id, name: label.name })
				.from(label)
				.where(eq(label.projectId, params.id));
			if (others.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase()))
				return fail(400, { message: 'A label with that name exists' });
			set.name = name;
		}
		if (form.has('color')) set.color = parseColor(form.get('color'));
		if (form.has('icon')) set.icon = parseIconValue(form.get('icon'));
		if (Object.keys(set).length) await db.update(label).set(set).where(eq(label.id, id));
		return { success: true };
	},

	deleteProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(label).where(and(eq(label.id, id), eq(label.projectId, params.id)));
		return { success: true };
	},

	/* ---------------------------- dependencies ---------------------------- */

	addProjectDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const dependsOnId = String(form.get('dependsOnId') ?? '');
		if (!dependsOnId || dependsOnId === params.id)
			return fail(400, { message: 'Invalid dependency' });

		const [target] = await db.select().from(project).where(eq(project.id, dependsOnId));
		if (!target) return fail(400, { message: 'Unknown project' });

		const all = await db.select().from(projectDependency);
		const edges = new Map<string, string[]>();
		for (const e of all) edges.set(e.projectId, [...(edges.get(e.projectId) ?? []), e.dependsOnId]);
		if (createsCycle(edges, params.id, dependsOnId))
			return fail(400, { message: 'That dependency would create a cycle' });

		await db
			.insert(projectDependency)
			.values({ projectId: params.id, dependsOnId })
			.onConflictDoNothing();
		return { success: true };
	},

	removeProjectDep: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const dependsOnId = String(form.get('dependsOnId') ?? '');
		await db
			.delete(projectDependency)
			.where(
				and(
					eq(projectDependency.projectId, params.id),
					eq(projectDependency.dependsOnId, dependsOnId)
				)
			);
		return { success: true };
	},

	/* ----------------------------- milestones ----------------------------- */

	createMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const targetDateRaw = String(form.get('targetDate') ?? '');

		if (!name) return fail(400, { message: 'Milestone name is required' });

		const now = new Date();
		await db.insert(milestone).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			name,
			targetDate: targetDateRaw ? new Date(targetDateRaw + 'T00:00:00') : null,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});
		return { success: true };
	},

	deleteMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(milestone).where(and(eq(milestone.id, id), eq(milestone.projectId, params.id)));
		return { success: true };
	},

	/* ----------------------------- locations ----------------------------- */

	createLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const address = String(form.get('address') ?? '').trim() || null;

		if (!title) return fail(400, { message: 'Location title is required' });
		const coords = parseCoords(form);
		if ('error' in coords) return fail(400, { message: coords.error });

		const now = new Date();
		await db.insert(location).values({
			id: crypto.randomUUID(),
			projectId: params.id,
			title,
			address,
			latitude: coords.lat,
			longitude: coords.lng,
			position: now.getTime(),
			createdAt: now,
			updatedAt: now
		});
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	updateLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const address = String(form.get('address') ?? '').trim() || null;

		const [loc] = await db.select().from(location).where(eq(location.id, id));
		if (!loc || loc.projectId !== params.id) return fail(400, { message: 'Invalid location' });
		if (!title) return fail(400, { message: 'Location title is required' });
		const coords = parseCoords(form);
		if ('error' in coords) return fail(400, { message: coords.error });

		await db
			.update(location)
			.set({ title, address, latitude: coords.lat, longitude: coords.lng, updatedAt: new Date() })
			.where(eq(location.id, id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteLocation: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(location).where(and(eq(location.id, id), eq(location.projectId, params.id)));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	/* ----------------------------- permissions ----------------------------- */

	grantPermission: async ({ request, params, locals }) => {
		if (!locals.user || !isAdmin(locals.user))
			return fail(403, { message: 'Only admins can grant permissions' });

		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const resourceType = String(form.get('resourceType') ?? '');
		const resourceId = String(form.get('resourceId') ?? '');

		if (!userId || !['project', 'view'].includes(resourceType) || !resourceId)
			return fail(400, { message: 'Invalid grant' });
		if (resourceType === 'project' && resourceId !== params.id)
			return fail(400, { message: 'Invalid grant' });
		if (resourceType === 'view') {
			const [v] = await db.select().from(view).where(eq(view.id, resourceId));
			if (!v || v.projectId !== params.id) return fail(400, { message: 'Invalid view' });
		}

		await db
			.insert(permission)
			.values({
				id: crypto.randomUUID(),
				userId,
				resourceType,
				resourceId,
				grantedBy: locals.user.id,
				createdAt: new Date()
			})
			.onConflictDoNothing();
		return { success: true };
	},

	revokePermission: async ({ request, locals }) => {
		if (!locals.user || !isAdmin(locals.user))
			return fail(403, { message: 'Only admins can revoke permissions' });

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await db.delete(permission).where(eq(permission.id, id));
		return { success: true };
	}
};
