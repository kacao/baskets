import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { apiKey, user } from './db/schema';

export const API_KEY_PREFIX = 'bsk_';

export function generateApiKey() {
	const token = API_KEY_PREFIX + randomBytes(32).toString('base64url');
	return {
		token,
		prefix: token.slice(0, 12),
		keyHash: hashApiKey(token)
	};
}

export function hashApiKey(token: string) {
	return createHash('sha256').update(token).digest('hex');
}

export async function resolveApiKey(token: string) {
	if (!token.startsWith(API_KEY_PREFIX)) return null;

	const keyHash = hashApiKey(token);
	const [row] = await db
		.select({ key: apiKey, user })
		.from(apiKey)
		.innerJoin(user, eq(apiKey.userId, user.id))
		.where(eq(apiKey.keyHash, keyHash));

	if (!row) return null;
	// Defense in depth: eq() on the unique hash already did the lookup,
	// but compare again in constant time before trusting the row.
	const a = Buffer.from(row.key.keyHash, 'hex');
	const b = Buffer.from(keyHash, 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	if (row.user.banned) return null;

	await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.key.id));

	return row.user;
}
