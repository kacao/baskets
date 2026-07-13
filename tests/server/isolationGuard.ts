import { beforeAll } from 'vitest';
import { eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { workspace, user } from '$lib/server/db/schema.sqlite';

// THE TRIPWIRE. Runs in-worker (where the `db` singleton is actually built from
// `$env/dynamic/private`) BEFORE any test in this suite executes. If the shell-env
// retarget (see package.json `test:server` script) failed for any reason — e.g.
// `.env`'s DATABASE_URL clobbered the shell value — `db` would still point at
// ./data/baskets.db (the dev DB). Proving the sentinel row planted by
// globalSetup.ts is visible through the `db` singleton is the ONLY thing that
// licenses any test below to call resetTables()/mutate anything.
//
// If the sentinel is NOT found, we throw — aborting the ENTIRE suite with ZERO
// mutations having been attempted through `db`.

export const SENTINEL_WORKSPACE_ID = '__ISO_SENTINEL__';
export const SENTINEL_USER_ID = '__ISO_SENTINEL_USER__';

export async function assertIsolated(): Promise<void> {
	const rows = await db.select().from(workspace).where(eq(workspace.id, SENTINEL_WORKSPACE_ID));
	if (rows.length === 0) {
		throw new Error(
			'ISOLATION FAILED: db singleton is not pointed at ./data/test-server.db (shell-env ' +
				'DATABASE_URL did not retarget $env/dynamic/private). Aborting before any mutation ' +
				'to protect the dev DB.'
		);
	}
}

beforeAll(async () => {
	await assertIsolated();
});

/**
 * FK-safe wipe of every app + auth row EXCEPT the sentinel user/workspace,
 * so the tripwire stays valid for the next test file too. Re-asserts isolation
 * first and refuses (throws) if the sentinel has somehow gone missing.
 *
 * Deletion order respects FKs (children before parents); tables not yet used by
 * any fixture are included for completeness but are always empty in this suite.
 */
export async function resetTables(): Promise<void> {
	await assertIsolated();

	const {
		taskCustomValue,
		projectCustomValue,
		customFieldOption,
		customField,
		file,
		comment,
		activity,
		notification,
		template,
		taskLabel,
		projectLabel,
		taskDependency,
		projectDependency,
		milestoneDependency,
		milestone,
		location,
		label,
		labelGroup,
		task,
		view,
		projectStatus,
		status,
		permission,
		project,
		apiKey,
		integration,
		session,
		account,
		verification,
		twoFactor
	} = await import('$lib/server/db/schema.sqlite');

	// children first
	await db.delete(taskCustomValue);
	await db.delete(projectCustomValue);
	await db.delete(customFieldOption);
	await db.delete(customField);
	await db.delete(file);
	await db.delete(comment);
	await db.delete(activity);
	await db.delete(notification);
	await db.delete(template);
	await db.delete(taskLabel);
	await db.delete(projectLabel);
	await db.delete(taskDependency);
	await db.delete(projectDependency);
	await db.delete(milestoneDependency);
	await db.delete(milestone);
	await db.delete(location);
	await db.delete(label);
	await db.delete(labelGroup);
	await db.delete(task);
	await db.delete(view);
	await db.delete(projectStatus);
	// Preserve the 5 built-in app-wide statuses: `ensureDefaultStatuses` (called by
	// fixture helpers) is idempotent via a module-level `ensured` flag, so once it
	// has run once in a test file it will NOT re-insert rows this reset deletes —
	// wiping them here would silently leave the app-wide default statuses gone for
	// every subsequent test in the file. Custom (non-built-in) statuses are still
	// cleared for isolation between tests.
	await db.delete(status).where(eq(status.builtIn, false));
	await db.delete(permission);
	await db.delete(project);
	await db.delete(apiKey);
	await db.delete(integration);
	await db.delete(session);
	await db.delete(account);
	await db.delete(verification);
	await db.delete(twoFactor);
	// workspace/user: delete everything EXCEPT the sentinel row, keeping the
	// tripwire valid for subsequent test files in the same run.
	await db.delete(workspace).where(ne(workspace.id, SENTINEL_WORKSPACE_ID));
	await db.delete(user).where(ne(user.id, SENTINEL_USER_ID));

	await assertIsolated();
}
