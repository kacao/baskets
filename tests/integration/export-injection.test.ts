import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for CSV formula-injection neutralization in the project
 * export endpoint (GET /api/projects/[id]/export).
 *
 * A task whose title begins with `=` (or +, -, @, tab, CR) must be exported
 * with a leading single-quote so spreadsheet apps (Excel/Sheets) treat it as
 * text rather than evaluating it as a formula (e.g. =HYPERLINK(...)). See
 * csvCell() in src/routes/api/projects/[id]/export/+server.ts.
 *
 * Hits the RUNNING dev server end to end. Auth: signs in the seeded admin via
 * BetterAuth (scripts/seed.ts creds), setting the Origin header for CSRF, and
 * reuses the returned session cookie. If the server is unreachable or auth
 * can't be established, the suite SKIPS rather than failing hard. The project
 * created here is deleted in afterAll (cascading its task).
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
// Seeded admin (see scripts/seed.ts — keep in sync if creds change).
const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// A classic CSV/formula-injection payload — leading `=` makes spreadsheet apps
// evaluate it unless neutralized with a leading single-quote.
const EVIL_TITLE = '=HYPERLINK("http://evil","x")';

let cookie = '';
let skipReason = '';
const createdProjectIds = new Set<string>();

/** fetch wrapper that attaches the session cookie + JSON content-type. */
async function api(
	path: string,
	init: RequestInit & { json?: unknown } = {}
): Promise<Response> {
	const { json: body, headers, ...rest } = init;
	return fetch(`${BASE}${path}`, {
		...rest,
		headers: {
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			...(cookie ? { cookie } : {}),
			...(headers ?? {})
		},
		body: body !== undefined ? JSON.stringify(body) : (rest.body as BodyInit | undefined)
	});
}

beforeAll(async () => {
	// 1) Is the server up at all?
	let reachable = false;
	try {
		const ping = await fetch(`${BASE}/api/me`);
		reachable = ping.status !== undefined;
	} catch {
		reachable = false;
	}
	if (!reachable) {
		skipReason = `dev server not reachable at ${BASE} — start it with \`npm run dev\``;
		return;
	}

	// 2) Sign in via BetterAuth (mounted by hooks at /api/auth/...).
	let res: Response;
	try {
		res = await fetch(`${BASE}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
		});
	} catch (err) {
		skipReason = `sign-in request failed: ${(err as Error).message}`;
		return;
	}
	if (!res.ok) {
		skipReason = `sign-in returned ${res.status} — is the DB seeded (npm run db:seed)?`;
		return;
	}
	// BetterAuth sets the session via Set-Cookie; reuse the raw cookie pairs.
	const setCookie = res.headers.get('set-cookie');
	if (!setCookie) {
		skipReason = 'sign-in succeeded but no session cookie was returned';
		return;
	}
	cookie = setCookie
		.split(/,(?=[^;]+?=)/)
		.map((c) => c.split(';')[0].trim())
		.join('; ');

	// 3) Confirm the cookie actually authenticates.
	const me = await api('/api/me');
	if (!me.ok) {
		skipReason = `session cookie did not authenticate (/api/me → ${me.status})`;
		cookie = '';
	}
});

afterAll(async () => {
	if (!cookie) return;
	for (const id of createdProjectIds) {
		try {
			await api(`/api/projects/${id}`, { method: 'DELETE' });
		} catch {
			// best-effort cleanup
		}
	}
});

/** Guard the test: skip with the reason when auth wasn't established. */
function ensureAuth() {
	if (!cookie) {
		// eslint-disable-next-line no-console
		console.warn(`[export-injection] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}

const rid = () => crypto.randomUUID();

/**
 * Minimal RFC-4180 CSV parser (handles quoted fields with embedded commas,
 * CRLF and doubled quotes) — enough to read back the exported rows/cells.
 */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (c === '\r') {
			// swallow — newline handled on \n
		} else {
			field += c;
		}
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

describe('CSV export: formula-injection neutralization (integration)', () => {
	it('prefixes a leading single-quote to a task title starting with =', async () => {
		if (!ensureAuth()) return;

		// Create a project + a task whose title is a formula-injection payload.
		const projRes = await api('/api/projects', {
			method: 'POST',
			json: { name: `itest-export-${rid()}` }
		});
		expect(projRes.status).toBe(201);
		const projectId = (await projRes.json())?.project?.id as string;
		expect(projectId).toBeTruthy();
		createdProjectIds.add(projectId);

		const taskRes = await api('/api/tasks', {
			method: 'POST',
			json: { projectId, title: EVIL_TITLE }
		});
		expect(taskRes.status).toBe(201);

		// Export and parse the CSV.
		const exportRes = await api(`/api/projects/${projectId}/export`);
		expect(exportRes.status).toBe(200);
		expect(exportRes.headers.get('content-type')).toContain('text/csv');

		let body = await exportRes.text();
		// Strip a leading UTF-8 BOM if present.
		if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

		const rows = parseCsv(body);
		expect(rows.length).toBeGreaterThan(1); // header + at least one task

		const header = rows[0];
		const titleCol = header.indexOf('Title');
		expect(titleCol).toBeGreaterThanOrEqual(0);

		const titles = rows.slice(1).map((r) => r[titleCol]);
		// The neutralized cell keeps the original payload but with a leading '.
		const neutralized = `'${EVIL_TITLE}`;
		const cell = titles.find((t) => t === neutralized);
		expect(cell, 'expected a neutralized title cell in the export').toBeTruthy();
		// Leading single-quote sits before the = so spreadsheets treat it as text.
		expect(cell!.startsWith("'=")).toBe(true);
		// And the un-neutralized raw payload must NOT appear.
		expect(titles).not.toContain(EVIL_TITLE);
	});
});
