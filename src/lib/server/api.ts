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

/**
 * Parse a date form/body field uniformly: null/'' → null, a full ISO string
 * (contains 'T') as-is, and a bare 'YYYY-MM-DD' by appending 'T00:00:00'.
 * Returns `null` for empty input; a non-string non-null value throws
 * ApiValidationError. `allowEmpty` (default true) governs '' → null.
 */
export function parseDateField(
	value: unknown,
	opts: { allowEmpty?: boolean } = {}
): Date | null {
	const { allowEmpty = true } = opts;
	if (value === null || value === undefined) return null;
	if (value === '' && allowEmpty) return null;
	if (typeof value !== 'string') throw new ApiValidationError('date must be a string');
	const d = new Date(value.includes('T') ? value : value + 'T00:00:00');
	if (isNaN(d.getTime())) throw new ApiValidationError('invalid date');
	return d;
}

export class ApiValidationError extends Error {}
