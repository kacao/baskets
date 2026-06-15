import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	customFieldOption,
	file,
	location,
	milestone,
	project,
	status,
	task,
	taskCustomValue,
	user
} from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { listProjectStatuses } from '$lib/server/statuses';
import { listProjectCustomFields } from '$lib/server/customFields';
import { decodeValue, formatDate, formatNumber, MULTI_CAPABLE } from '$lib/customFields';
import type { RequestHandler } from './$types';

/** Escape one CSV cell per RFC 4180: wrap in quotes when it contains
 *  a comma, quote, CR or LF, doubling any embedded quotes. */
function csvCell(value: unknown): string {
	const s = value == null ? '' : String(value);
	if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
	return s;
}

function csvRow(cells: unknown[]): string {
	return cells.map(csvCell).join(',');
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();
	if (format !== 'csv') return apiError(400, 'Unsupported format (only csv)');

	const [tasks, milestones, locations, statuses, customFields] = await Promise.all([
		db
			.select()
			.from(task)
			.where(eq(task.projectId, params.id))
			.orderBy(asc(task.position), asc(task.createdAt)),
		db.select().from(milestone).where(eq(milestone.projectId, params.id)),
		db.select().from(location).where(eq(location.projectId, params.id)),
		listProjectStatuses(params.id),
		listProjectCustomFields(params.id)
	]);

	const taskIds = tasks.map((t) => t.id);

	// Lookup maps for human-readable references
	const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));
	const milestoneName = new Map(milestones.map((m) => [m.id, m.name]));
	const locationTitle = new Map(locations.map((l) => [l.id, l.title]));
	const statusName = new Map(
		(statuses as { id: string; name: string }[]).map((s) => [s.id, s.name])
	);

	const fieldIds = customFields.map((f) => f.id);
	const [optionRows, valueRows] = await Promise.all([
		fieldIds.length
			? db.select().from(customFieldOption).where(inArray(customFieldOption.fieldId, fieldIds))
			: Promise.resolve([] as (typeof customFieldOption.$inferSelect)[]),
		taskIds.length
			? db.select().from(taskCustomValue).where(inArray(taskCustomValue.taskId, taskIds))
			: Promise.resolve([] as (typeof taskCustomValue.$inferSelect)[])
	]);

	const optionTitle = new Map(optionRows.map((o) => [o.id, o.title]));

	// Resolve user + file references that appear in person/files custom values
	const userIds = new Set<string>();
	const fileIds = new Set<string>();
	for (const r of valueRows) {
		const f = customFields.find((cf) => cf.id === r.fieldId);
		if (!f) continue;
		if (f.type === 'person' || f.type === 'files') {
			try {
				const arr = JSON.parse(r.value);
				if (Array.isArray(arr)) for (const id of arr) (f.type === 'person' ? userIds : fileIds).add(String(id));
			} catch {
				/* ignore malformed */
			}
		}
	}
	// task.assigneeId references users too
	for (const t of tasks) if (t.assigneeId) userIds.add(t.assigneeId);

	const [users, files] = await Promise.all([
		userIds.size
			? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, [...userIds]))
			: Promise.resolve([] as { id: string; name: string }[]),
		fileIds.size
			? db.select({ id: file.id, filename: file.filename }).from(file).where(inArray(file.id, [...fileIds]))
			: Promise.resolve([] as { id: string; filename: string }[])
	]);
	const userName = new Map(users.map((u) => [u.id, u.name]));
	const fileName = new Map(files.map((f) => [f.id, f.filename]));

	// values keyed by task -> field
	const valByTask = new Map<string, Map<string, string>>();
	for (const r of valueRows) {
		let m = valByTask.get(r.taskId);
		if (!m) valByTask.set(r.taskId, (m = new Map()));
		m.set(r.fieldId, r.value);
	}

	const fieldById = new Map(customFields.map((f) => [f.id, f]));

	/** Render one custom-field stored value into a display string for CSV. */
	function renderCustom(fieldId: string, raw: string | undefined): string {
		const field = fieldById.get(fieldId);
		if (!field || raw == null || raw === '') return '';
		const decoded = decodeValue(field, raw);
		if (MULTI_CAPABLE.has(field.type)) {
			const ids = Array.isArray(decoded) ? (decoded as string[]) : [];
			const labels = ids.map((id) => {
				if (field.type === 'select') return optionTitle.get(id) ?? id;
				if (field.type === 'person') return userName.get(id) ?? id;
				if (field.type === 'place') return locationTitle.get(id) ?? id;
				if (field.type === 'files') return fileName.get(id) ?? id;
				return id;
			});
			return labels.join('; ');
		}
		switch (field.type) {
			case 'checkbox':
				return decoded ? 'Yes' : 'No';
			case 'number': {
				const n = Number(decoded);
				return Number.isFinite(n) ? formatNumber(n, field.config) : '';
			}
			case 'date':
				return formatDate(String(decoded), field.config);
			case 'task':
				return taskTitle.get(String(decoded)) ?? String(decoded);
			default:
				return String(decoded);
		}
	}

	const PRIORITY_LABELS: Record<string, string> = {
		none: '',
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		urgent: 'Urgent'
	};

	const header = [
		'Title',
		'Parent',
		'Status',
		'Priority',
		'Assignee',
		'Milestone',
		'Due Date',
		...customFields.map((f) => f.name),
		'Estimated Cost',
		'Actual Cost'
	];

	const estId = proj.estimatedCostFieldId;
	const actId = proj.actualCostFieldId;

	const lines = [csvRow(header)];
	for (const t of tasks) {
		const vals = valByTask.get(t.id);
		const row: unknown[] = [
			t.title,
			t.parentId ? (taskTitle.get(t.parentId) ?? '') : '',
			t.statusId ? (statusName.get(t.statusId) ?? '') : '',
			PRIORITY_LABELS[t.priority] ?? t.priority ?? '',
			t.assigneeId ? (userName.get(t.assigneeId) ?? '') : '',
			t.milestoneId ? (milestoneName.get(t.milestoneId) ?? '') : '',
			t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : ''
		];
		for (const f of customFields) row.push(renderCustom(f.id, vals?.get(f.id)));
		row.push(estId ? renderCustom(estId, vals?.get(estId)) : '');
		row.push(actId ? renderCustom(actId, vals?.get(actId)) : '');
		lines.push(csvRow(row));
	}

	// UTF-8 BOM so spreadsheet apps detect encoding; CRLF line endings (RFC 4180)
	const body = '﻿' + lines.join('\r\n') + '\r\n';
	const safeName = (proj.name || 'project').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'project';

	return new Response(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${safeName}-tasks.csv"`,
			'Cache-Control': 'no-store'
		}
	});
};
