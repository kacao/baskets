import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
	customField,
	customFieldOption,
	file,
	location,
	project,
	projectCustomValue,
	task,
	taskCustomValue,
	user
} from './db/schema';
import { projectAccessUserIds } from './permissions';
import {
	CUSTOM_FIELD_TYPES,
	EMAIL_RE,
	MULTI_CAPABLE,
	PHONE_RE,
	decodeValue,
	fieldAppliesTo,
	isValidUrl,
	sanitizeConfig,
	type CustomFieldType
} from '$lib/customFields';

export * from '$lib/customFields';

/** Custom field rows for a project (config parsed), ordered for display. */
export async function listProjectCustomFields(projectId: string) {
	const rows = await db
		.select()
		.from(customField)
		.where(eq(customField.projectId, projectId))
		.orderBy(asc(customField.position), asc(customField.createdAt));
	return rows.map((r) => ({ ...r, config: parseConfig(r.config) }));
}

/** Options for a set of select fields, ordered. */
export async function listCustomFieldOptions(fieldIds: string[]) {
	if (fieldIds.length === 0) return [];
	return db
		.select()
		.from(customFieldOption)
		.where(inArray(customFieldOption.fieldId, fieldIds))
		.orderBy(asc(customFieldOption.position), asc(customFieldOption.createdAt));
}

export function parseConfig(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' ? v : {};
	} catch {
		return {};
	}
}

export const isCustomFieldType = (t: string): t is CustomFieldType =>
	(CUSTOM_FIELD_TYPES as readonly string[]).includes(t);

type Loaded = { id: string; type: string; config: Record<string, unknown> };
type EncodeResult = { value: string | null } | { error: string };

/** Validate + canonicalize one raw form value against its field definition. */
async function encodeAndValidate(field: Loaded, raw: string | null, projectId: string): Promise<EncodeResult> {
	const type = field.type;
	const s = raw == null ? '' : String(raw);

	if (MULTI_CAPABLE.has(type)) {
		let ids: string[] = [];
		if (s.trim()) {
			try {
				const v = JSON.parse(s);
				if (Array.isArray(v)) ids = v.map(String);
				else if (type === 'task') ids = [s.trim()]; // legacy scalar task id
				else return { error: 'Invalid value' };
			} catch {
				// a bare (non-JSON) id is only valid for the formerly-scalar `task` type
				if (type === 'task') ids = [s.trim()];
				else return { error: 'Invalid value' };
			}
		}
		ids = [...new Set(ids)];
		if (field.config.multi !== true && ids.length > 1) ids = ids.slice(0, 1);
		if (ids.length === 0) return { value: null };

		let valid: Set<string>;
		if (type === 'select') {
			const opts = await db
				.select({ id: customFieldOption.id })
				.from(customFieldOption)
				.where(eq(customFieldOption.fieldId, field.id));
			valid = new Set(opts.map((o) => o.id));
		} else if (type === 'person') {
			// person ids must be REAL users AND able to access this project — else a task
			// editor could store an arbitrary user's id and read their name via CSV export
			// (cross-project disclosure). Mirrors notifyMentions' scoping.
			const [proj] = await db
				.select({ workspaceId: project.workspaceId })
				.from(project)
				.where(eq(project.id, projectId));
			const roster = await projectAccessUserIds(projectId, proj?.workspaceId ?? null);
			const us = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
			valid = new Set(us.map((u) => u.id).filter((id) => roster.has(id)));
		} else if (type === 'place') {
			const locs = await db
				.select({ id: location.id })
				.from(location)
				.where(and(eq(location.projectId, projectId), inArray(location.id, ids)));
			valid = new Set(locs.map((l) => l.id));
		} else if (type === 'task') {
			const ts = await db
				.select({ id: task.id })
				.from(task)
				.where(and(eq(task.projectId, projectId), inArray(task.id, ids)));
			valid = new Set(ts.map((t) => t.id));
		} else {
			// files
			const fs = await db
				.select({ id: file.id })
				.from(file)
				.where(and(eq(file.projectId, projectId), inArray(file.id, ids)));
			valid = new Set(fs.map((f) => f.id));
		}
		if (!ids.every((id) => valid.has(id))) return { error: 'Invalid reference in custom field' };
		return { value: JSON.stringify(ids) };
	}

	switch (type) {
		case 'text': {
			const t = s.trim().slice(0, 2000);
			return { value: t || null };
		}
		case 'number': {
			if (!s.trim()) return { value: null };
			const n = Number(s);
			if (!Number.isFinite(n)) return { error: 'Invalid number' };
			return { value: String(n) };
		}
		case 'checkbox':
			return { value: s === 'true' ? 'true' : null };
		case 'email': {
			const v = s.trim();
			if (!v) return { value: null };
			if (!EMAIL_RE.test(v)) return { error: 'Invalid email' };
			return { value: v };
		}
		case 'phone': {
			const v = s.trim();
			if (!v) return { value: null };
			if (!PHONE_RE.test(v)) return { error: 'Invalid phone number' };
			return { value: v };
		}
		case 'url': {
			const v = s.trim();
			if (!v) return { value: null };
			if (!isValidUrl(v)) return { error: 'Invalid URL' };
			return { value: v };
		}
		case 'date': {
			const v = s.trim();
			if (!v) return { value: null };
			if (isNaN(+new Date(v))) return { error: 'Invalid date' };
			return { value: v };
		}
		case 'rollup':
			return { value: null }; // computed/display-only — never stored
		default:
			return { error: 'Unsupported field type' };
	}
}

/**
 * Validate + persist custom-field values for one task. Each entry's `raw` is the
 * raw form string (scalar, or a JSON-array string for multi-capable types);
 * empty clears the value (row deleted). Validates every reference against the
 * project (no cross-project leakage). Returns `{ error }` (nothing written) on
 * the first invalid entry, else `{}`.
 */
export async function writeTaskCustomValues(
	taskId: string,
	projectId: string,
	entries: { fieldId: string; raw: string | null }[]
): Promise<{ error?: string }> {
	if (entries.length === 0) return {};
	const fields = await db.select().from(customField).where(eq(customField.projectId, projectId));
	const byId = new Map(
		fields.map((f) => [
			f.id,
			{ id: f.id, type: f.type, appliesTo: f.appliesTo, entity: f.entity, config: parseConfig(f.config) }
		])
	);
	// the field must apply to this task's level (top-level vs sub-task)
	const [tk] = await db.select({ parentId: task.parentId }).from(task).where(eq(task.id, taskId));
	const isSubtask = !!tk?.parentId;

	const writes: { fieldId: string; value: string }[] = [];
	const clears: string[] = [];
	for (const { fieldId, raw } of entries) {
		const field = byId.get(fieldId);
		if (!field) return { error: 'Unknown custom field' };
		if (field.entity === 'project') return { error: 'Field is a project field, not a task field' };
		if (!fieldAppliesTo(field, isSubtask)) return { error: 'Field not available for this task' };
		const res = await encodeAndValidate(field, raw, projectId);
		if ('error' in res) return { error: res.error };
		if (res.value === null) clears.push(fieldId);
		else writes.push({ fieldId, value: res.value });
	}

	for (const fieldId of clears)
		await db.delete(taskCustomValue).where(and(eq(taskCustomValue.taskId, taskId), eq(taskCustomValue.fieldId, fieldId)));
	for (const w of writes)
		await db
			.insert(taskCustomValue)
			.values({ taskId, fieldId: w.fieldId, value: w.value })
			.onConflictDoUpdate({ target: [taskCustomValue.taskId, taskCustomValue.fieldId], set: { value: w.value } });
	return {};
}

/**
 * Validate + persist custom-field values for the PROJECT itself (entity='project'
 * fields, stored in project_custom_value). Mirrors writeTaskCustomValues but has
 * no task-level (appliesTo) check. Returns `{ error }` (nothing written) on the
 * first invalid entry, else `{}`.
 */
export async function writeProjectCustomValues(
	projectId: string,
	entries: { fieldId: string; raw: string | null }[]
): Promise<{ error?: string }> {
	if (entries.length === 0) return {};
	const fields = await db.select().from(customField).where(eq(customField.projectId, projectId));
	const byId = new Map(
		fields.map((f) => [f.id, { id: f.id, type: f.type, entity: f.entity, config: parseConfig(f.config) }])
	);
	const writes: { fieldId: string; value: string }[] = [];
	const clears: string[] = [];
	for (const { fieldId, raw } of entries) {
		const field = byId.get(fieldId);
		if (!field) return { error: 'Unknown custom field' };
		if (field.entity !== 'project') return { error: 'Field is not a project field' };
		const res = await encodeAndValidate(field, raw, projectId);
		if ('error' in res) return { error: res.error };
		if (res.value === null) clears.push(fieldId);
		else writes.push({ fieldId, value: res.value });
	}
	for (const fieldId of clears)
		await db
			.delete(projectCustomValue)
			.where(and(eq(projectCustomValue.projectId, projectId), eq(projectCustomValue.fieldId, fieldId)));
	for (const w of writes)
		await db
			.insert(projectCustomValue)
			.values({ projectId, fieldId: w.fieldId, value: w.value })
			.onConflictDoUpdate({
				target: [projectCustomValue.projectId, projectCustomValue.fieldId],
				set: { value: w.value }
			});
	return {};
}

/** Raw stored project-field values for a project. */
export async function listProjectCustomValues(projectId: string) {
	return db.select().from(projectCustomValue).where(eq(projectCustomValue.projectId, projectId));
}

/**
 * Per-task decoded custom-field values for a project, keyed
 * `{ [taskId]: { [fieldId]: decodedValue } }`. For REST payloads.
 */
export async function customValuesByTask(
	projectId: string,
	taskIds: string[]
): Promise<Record<string, Record<string, unknown>>> {
	if (taskIds.length === 0) return {};
	const fields = await listProjectCustomFields(projectId);
	const fieldById = new Map(fields.map((f) => [f.id, f]));
	const rows = await db.select().from(taskCustomValue).where(inArray(taskCustomValue.taskId, taskIds));
	const out: Record<string, Record<string, unknown>> = {};
	for (const r of rows) {
		const f = fieldById.get(r.fieldId);
		if (!f) continue;
		(out[r.taskId] ??= {})[r.fieldId] = decodeValue(f, r.value);
	}
	return out;
}

/** Convert a REST `customFields` map into writeTaskCustomValues entries. */
export function apiCustomFieldEntries(
	map: Record<string, unknown>
): { fieldId: string; raw: string }[] {
	return Object.entries(map).map(([fieldId, v]) => ({
		fieldId,
		raw:
			v == null
				? ''
				: Array.isArray(v)
					? JSON.stringify(v)
					: typeof v === 'boolean'
						? v
							? 'true'
							: ''
						: String(v)
	}));
}

/** Validate a field-definition config payload for a given type. Returns the JSON string to store. */
export function validateFieldConfig(type: string, rawJson: string): string {
	let parsed: unknown = {};
	try {
		parsed = JSON.parse(rawJson || '{}');
	} catch {
		parsed = {};
	}
	return JSON.stringify(sanitizeConfig(type, parsed));
}
