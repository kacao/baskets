import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { apiKey } from '$lib/server/db/schema';
import { generateApiKey } from '$lib/server/api-keys';
import { apiError, readJson } from '$lib/server/api';
import type { RequestHandler } from './$types';

// Per-user API keys. Never returns the hash or full token (plaintext shown once at creation).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const keys = await db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			prefix: apiKey.prefix,
			lastUsedAt: apiKey.lastUsedAt,
			createdAt: apiKey.createdAt
		})
		.from(apiKey)
		.where(eq(apiKey.userId, locals.user.id))
		.orderBy(desc(apiKey.createdAt));

	return json({ keys });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return apiError(400, 'Key name is required');
	if (name.length > 60) return apiError(400, 'Key name too long (max 60)');

	const { token, prefix, keyHash } = generateApiKey();
	const id = crypto.randomUUID();
	const createdAt = new Date();

	await db.insert(apiKey).values({
		id,
		name,
		prefix,
		keyHash,
		userId: locals.user.id,
		createdAt
	});

	// Plaintext token returned exactly once — only the hash is stored.
	return json(
		{ key: { id, name, prefix, lastUsedAt: null, createdAt }, token },
		{ status: 201 }
	);
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const id = typeof body.id === 'string' ? body.id : '';
	if (!id) return apiError(400, 'Missing key id');

	// Owner-scoped: a key the caller doesn't own is indistinguishable from missing (404).
	const deleted = await db
		.delete(apiKey)
		.where(and(eq(apiKey.id, id), eq(apiKey.userId, locals.user.id)))
		.returning({ id: apiKey.id });

	if (deleted.length === 0) return apiError(404, 'Key not found');

	return new Response(null, { status: 204 });
};
