import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	customField,
	customFieldOption,
	label,
	location,
	milestone,
	milestoneDependency,
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
	listProjectGrants,
	projectAccessUserIds
} from '$lib/server/permissions';
import { decodeValue } from '$lib/customFields';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { notifyMentions } from '$lib/server/mentions';
import { parseIconValue } from '$lib/server/icons';
import {
	createProjectStatus,
	deleteStatusById,
	listProjectCustomStatuses,
	listStatuses,
	listWorkspaceStatuses,
	reorderProjectStatuses,
	setProjectEligibleStatuses,
	updateStatusById,
	STATUS_CATEGORIES
} from '$lib/server/statuses';
import {
	createLabel,
	deleteLabelById,
	toggleProjectLabel,
	updateLabelById
} from '$lib/server/labels';
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
import { deleteFilesForField, deleteFilesForProject } from '$lib/server/uploads';
import { importProjectFromExport } from '$lib/server/projectIO';
import {
	milestoneProgressByProject,
	reorderMilestones,
	createMilestone as createMilestoneService,
	updateMilestoneById,
	deleteMilestoneById,
	setMilestoneDeps as setMilestoneDepsService
} from '$lib/server/milestones';
import type { Actions, PageServerLoad } from './$types';

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

const loadImpl = async ({ params, locals }: Parameters<PageServerLoad>[0]) => {
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

	// Task data for project-entity rollup fields (aggregate a target over all tasks).
	const hasRollup = customFields.some((f) => f.entity === 'project' && f.type === 'rollup');
	const [rollupTasks, rollupTaskValues] = hasRollup
		? await Promise.all([
				db.select({ id: task.id, parentId: task.parentId }).from(task).where(eq(task.projectId, params.id)),
				db
					.select({
						taskId: taskCustomValue.taskId,
						fieldId: taskCustomValue.fieldId,
						value: taskCustomValue.value
					})
					.from(taskCustomValue)
					.innerJoin(task, eq(taskCustomValue.taskId, task.id))
					.where(eq(task.projectId, params.id))
			])
		: [[], []];

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

	// ADR-019: admins manage grants and need the full roster; everyone else (workspace
	// owner / project grantee) only needs users who can access this project + any
	// already referenced by a person custom field, so the whole roster isn't exposed.
	let visibleUsers = users;
	if (!admin) {
		const ids = await projectAccessUserIds(params.id, proj.workspaceId);
		for (const f of customFields) {
			if (f.type !== 'person') continue;
			for (const v of projectCustomValues) {
				if (v.fieldId !== f.id) continue;
				const refs = decodeValue({ type: 'person' }, v.value);
				if (Array.isArray(refs)) for (const id of refs) ids.add(String(id));
			}
		}
		visibleUsers = users.filter((u) => ids.has(u.id));
	}

	// Milestone deps + per-milestone task progress for the rich milestones manager.
	const [milestoneDeps, milestoneProgress] = await Promise.all([
		db
			.select({
				milestoneId: milestoneDependency.milestoneId,
				dependsOnId: milestoneDependency.dependsOnId
			})
			.from(milestoneDependency)
			.innerJoin(milestone, eq(milestoneDependency.milestoneId, milestone.id))
			.where(eq(milestone.projectId, params.id)),
		milestoneProgressByProject(params.id)
	]);

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
		milestoneDeps,
		milestoneProgress,
		locations,
		customFields: customFields.map((f) => ({
			...f,
			inUse: cfUsage.find((u) => u.fieldId === f.id)?.n ?? 0
		})),
		customFieldOptions,
		projectCustomValues,
		rollupTasks,
		rollupTaskValues,
		fieldTypes: CUSTOM_FIELD_TYPES,
		users: visibleUsers,
		views,
		grants: admin ? await listProjectGrants(params.id) : [],
		perm: { admin }
	};
};

export const load: PageServerLoad = loadImpl;

/** Shared with the per-section sub-pages (statuses/labels/milestones/…) that reuse this load. */
export type ProjectSettingsData = Awaited<ReturnType<typeof loadImpl>>;

export const actions: Actions = {

	updateProject: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();

		if (!name) return fail(400, { message: 'Project name is required' });

		const [existing] = await db
			.select({ description: project.description })
			.from(project)
			.where(eq(project.id, params.id));
		if (!existing) return fail(404, { message: 'Project not found' });

		// patch-style: only touch start/due when the form actually carries them, so
		// posting from the Overview page (name + description only) doesn't null the dates
		const patch: Partial<typeof project.$inferInsert> = {
			name,
			description: description || null,
			updatedAt: new Date()
		};
		if (form.has('startDate')) {
			const raw = String(form.get('startDate') ?? '').trim();
			patch.startDate = raw ? new Date(raw + 'T00:00:00') : null;
		}
		if (form.has('dueDate')) {
			const raw = String(form.get('dueDate') ?? '').trim();
			patch.dueDate = raw ? new Date(raw + 'T00:00:00') : null;
		}

		await db.update(project).set(patch).where(eq(project.id, params.id));

		void notifyMentions({
			text: description || null,
			prevText: existing.description,
			actorId: locals.user.id,
			actorName: locals.user.name,
			projectId: params.id,
			contextLabel: `the project "${name}"`
		});
		broadcastProjectChange(params.id, locals.user.id);

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

	// Which project-entity custom fields show as header chips, and in what order.
	// Body: `fieldIds` = comma-separated ordered ids (empty string = show none). Stored
	// as a JSON array on `project.chipFields`; null (never set) = show all with a value.
	setProjectChipFields: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const raw = String((await request.formData()).get('fieldIds') ?? '');
		const ids = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
		// keep only this project's own (entity='project') fields, deduped, in given order
		const valid = new Set(
			(await listProjectCustomFields(params.id))
				.filter((f) => (f.entity ?? 'task') === 'project')
				.map((f) => f.id)
		);
		const clean = [...new Set(ids)].filter((id) => valid.has(id));

		await db
			.update(project)
			.set({ chipFields: JSON.stringify(clean), updatedAt: new Date() })
			.where(eq(project.id, params.id));
		broadcastProjectChange(params.id, locals.user.id);
		return { success: true };
	},

	deleteProject: async ({ params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });
		await deleteFilesForProject(params.id);
		await db.delete(project).where(eq(project.id, params.id));
		redirect(303, '/projects');
	},

	// Import a project export (JSON) → creates a NEW project in this project's
	// workspace. Gated on edit permission (it creates a project).
	importProject: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'Choose a JSON file to import' });
		if (file.size > 5 * 1024 * 1024) return fail(400, { message: 'File too large (max 5 MB)' });

		let doc: unknown;
		try {
			doc = JSON.parse(await file.text());
		} catch {
			return fail(400, { message: 'Invalid JSON file' });
		}

		const [proj] = await db
			.select({ workspaceId: project.workspaceId })
			.from(project)
			.where(eq(project.id, params.id));
		if (!proj?.workspaceId) return fail(400, { message: 'Project has no workspace' });

		let newId: string;
		try {
			newId = await importProjectFromExport(doc, {
				workspaceId: proj.workspaceId,
				creator: { id: locals.user.id, role: locals.user.role }
			});
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : 'Import failed' });
		}
		redirect(303, '/projects/' + newId);
	},

	/* ----------------------- project-scoped statuses ----------------------- */

	createStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await createProjectStatus(
			params.id,
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				category: String(form.get('category') ?? 'backlog'),
				color: form.get('color'),
				icon: form.get('icon')
			},
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await updateStatusById(
			String(form.get('id') ?? ''),
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				category: String(form.get('category') ?? 'backlog'),
				color: form.get('color'),
				icon: form.get('icon')
			},
			locals.user,
			{ has: () => true, owner: { projectId: params.id } }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteStatusById(id, locals.user, { owner: { projectId: params.id } });
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Reorder this project's custom statuses (positions only; category unchanged). */
	reorderStatus: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const ids = String((await request.formData()).get('ids') ?? '').split(',');
		const res = await reorderProjectStatuses(params.id, ids, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateProjectStatuses: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const statusIds = (await request.formData()).getAll('statusIds').map(String).filter(Boolean);
		const res = await setProjectEligibleStatuses(params.id, statusIds, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
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

		// uniqueness is per-(project, entity): task + project fields are separate value
		// tables, so a task field and a project field MAY share a name.
		const existing = await db
			.select({ name: customField.name, position: customField.position })
			.from(customField)
			.where(and(eq(customField.projectId, params.id), eq(customField.entity, entity)))
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

		// uniqueness is per-(project, entity) — only collide with same-entity fields
		const others = await db
			.select({ id: customField.id, name: customField.name })
			.from(customField)
			.where(and(eq(customField.projectId, params.id), eq(customField.entity, f.entity)));
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

		const labelId = String((await request.formData()).get('labelId') ?? '');
		const res = await toggleProjectLabel(params.id, labelId, locals.user);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	// Project-scoped labels: owned by this project (label.projectId), always
	// available to its tasks — distinct from toggling shared workspace labels.
	createProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await createLabel(
			{ type: 'project', id: params.id },
			{ name: String(form.get('name') ?? ''), color: form.get('color'), icon: form.get('icon') },
			locals.user
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await updateLabelById(
			String(form.get('id') ?? ''),
			{ name: String(form.get('name') ?? ''), color: form.get('color'), icon: form.get('icon') },
			locals.user,
			{ has: (key) => form.has(key), owner: { projectId: params.id }, emptyOk: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteProjectLabel: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteLabelById(id, locals.user, { owner: { projectId: params.id } });
		if (!res.ok) return fail(res.status, { message: res.message });
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

		const form = await request.formData();
		const res = await createMilestoneService(
			params.id,
			{
				name: String(form.get('name') ?? ''),
				description: String(form.get('description') ?? '').trim() || null,
				startDate: String(form.get('startDate') ?? ''),
				targetDate: String(form.get('targetDate') ?? '')
			},
			locals.user,
			{ broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	updateMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await updateMilestoneById(
			String(form.get('id') ?? ''),
			{
				name: form.has('name') ? String(form.get('name') ?? '') : undefined,
				description: form.has('description')
					? String(form.get('description') ?? '').trim() || null
					: undefined,
				startDate: form.has('startDate') ? String(form.get('startDate') ?? '').trim() : undefined,
				targetDate: form.has('targetDate') ? String(form.get('targetDate') ?? '').trim() : undefined
			},
			locals.user,
			{ has: (key) => form.has(key), owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	deleteMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const id = String((await request.formData()).get('id') ?? '');
		const res = await deleteMilestoneById(id, locals.user, {
			owner: { projectId: params.id },
			broadcast: true
		});
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Replaces a milestone's full dependency set (DFS cycle-checked). */
	setMilestoneDeps: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const form = await request.formData();
		const res = await setMilestoneDepsService(
			String(form.get('milestoneId') ?? ''),
			form.getAll('dependsOnId').map(String),
			locals.user,
			{ owner: { projectId: params.id }, broadcast: true }
		);
		if (!res.ok) return fail(res.status, { message: res.message });
		return { success: true };
	},

	/** Reorder milestones from a comma-separated ordered id list (`ids`). */
	reorderMilestone: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: 'Not signed in' });
		if (!(await canEditProject(locals.user, params.id)))
			return fail(403, { message: 'No edit permission on this project' });

		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		await reorderMilestones(params.id, ids);
		broadcastProjectChange(params.id, locals.user.id);
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
