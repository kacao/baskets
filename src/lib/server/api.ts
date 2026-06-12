import { json } from '@sveltejs/kit';

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

export function apiError(status: number, message: string) {
	return json({ error: message }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const body = await request.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
	} catch {
		return null;
	}
}

export function optionalString(value: unknown, field: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string') throw new ApiValidationError(`${field} must be a string`);
	return value.trim() || null;
}

export class ApiValidationError extends Error {}
