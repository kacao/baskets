import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { savedFilter } from './db/schema';

export type SavedFilterRow = typeof savedFilter.$inferSelect;

/** All saved filters for a project, oldest first. */
export async function listSavedFilters(projectId: string): Promise<SavedFilterRow[]> {
	return db
		.select()
		.from(savedFilter)
		.where(eq(savedFilter.projectId, projectId))
		.orderBy(asc(savedFilter.createdAt), asc(savedFilter.name));
}

/** A single saved filter (or null). */
export async function getSavedFilter(id: string): Promise<SavedFilterRow | null> {
	const [row] = await db.select().from(savedFilter).where(eq(savedFilter.id, id));
	return row ?? null;
}

/**
 * Create a project-scoped saved filter. `config` is schemaless filter JSON
 * (e.g. { statusIds, groupBy, sortBy, ... }); it is stored verbatim after a
 * round-trip through JSON to guarantee it is a valid JSON object string.
 */
export async function createSavedFilter(input: {
	projectId: string;
	name: string;
	config: unknown;
	createdBy: string;
}): Promise<SavedFilterRow> {
	const name = input.name.trim();
	if (!name) throw new Error('Filter name is required');
	if (name.length > 120) throw new Error('Filter name too long (max 120)');

	let configJson = '{}';
	const parsed = input.config;
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		configJson = JSON.stringify(parsed);
	} else {
		throw new Error('Invalid filter config');
	}

	const now = new Date();
	const id = crypto.randomUUID();
	await db.insert(savedFilter).values({
		id,
		projectId: input.projectId,
		name,
		config: configJson,
		createdBy: input.createdBy,
		createdAt: now
	});
	return { id, projectId: input.projectId, name, config: configJson, createdBy: input.createdBy, createdAt: now };
}

/** Delete a saved filter, scoped to its project (guards cross-project deletes). */
export async function deleteSavedFilter(id: string, projectId: string): Promise<boolean> {
	const existing = await getSavedFilter(id);
	if (!existing || existing.projectId !== projectId) return false;
	await db.delete(savedFilter).where(eq(savedFilter.id, id));
	return true;
}

/** Parse a saved filter's stored config to a plain object (never throws). */
export function parseSavedFilterConfig(row: { config: string }): Record<string, unknown> {
	try {
		const parsed = JSON.parse(row.config);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}
