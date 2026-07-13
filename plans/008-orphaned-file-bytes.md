# Plan 008: Unlink file bytes from disk when a task or project is deleted

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/server/tasks.ts src/lib/server/uploads.ts src/routes/api/tasks/[id]/+server.ts src/routes/api/projects/[id]/+server.ts "src/routes/(app)/projects"`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **IMPORTANT — uncommitted edits at planning time**: `src/lib/server/tasks.ts`
> had UNCOMMITTED working-tree edits when this plan was written (a milestone-
> inheritance feature) affecting `createTaskService` and the `updateTaskService`
> re-parent branch — NOT `deleteTaskService`/`bulkDeleteTasks`. `git diff --stat
> 3958dd6..HEAD` may show nothing while the working tree differs. Match excerpts
> by code content, not line number.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

Uploaded files store their bytes on local disk under `UPLOADS_DIR` (default
`./data/uploads/<projectId>/<uuid><ext>`); the DB `file` row records the relative
`storagePath`. The `file.taskId` and `file.projectId` foreign keys are
`onDelete: 'cascade'` and `foreign_keys = ON`, so deleting a task or project
silently removes the `file` DB rows — but NOTHING deletes the bytes on disk. So
every deleted task/project leaks its attachment + custom-field-file bytes forever,
and because the DB row is gone there is no longer any record of what to clean up.
Over time `UPLOADS_DIR` grows unbounded with unreferenced files. This plan adds a
best-effort unlink of the bytes BEFORE the DB rows cascade away, in a shared
helper wired into every task- and project-deletion site.

## Current state

### The cascade + FK that removes rows but not bytes

`src/lib/server/db/schema.sqlite.ts` — the `file` table (note the cascades):

```ts
export const file = sqliteTable('file', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	fieldId: text('field_id').references(() => customField.id, { onDelete: 'set null' }),
	taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	mimeType: text('mime_type').notNull(),
	size: integer('size').notNull(),
	storagePath: text('storage_path').notNull(),
	// ...
});
```

`src/lib/server/db/index.ts` enables the FK cascade: `sqlite.pragma('foreign_keys = ON');`.

### The existing per-field unlink helper to MIRROR

`src/lib/server/uploads.ts` already does exactly this pattern for field deletion —
copy its shape (imports: `unlink` from `node:fs/promises`, `filePath`, `db`,
`file`, `eq`):

```ts
export const filePath = (storagePath: string) => join(UPLOADS_DIR, storagePath);

export async function deleteFilesForField(fieldId: string) {
	const rows = await db.select().from(file).where(eq(file.fieldId, fieldId));
	for (const f of rows) {
		try {
			await unlink(filePath(f.storagePath));
		} catch {
			// already gone — fine
		}
	}
	if (rows.length > 0) await db.delete(file).where(eq(file.fieldId, fieldId));
}
```

`uploads.ts` currently imports only `{ eq }` from `drizzle-orm` — you will need
`inArray` too.

### The 6 deletion sites that leak bytes today

**Task deletes (service layer — ADR-049):**

`src/lib/server/tasks.ts` — `deleteTaskService`:

```ts
	await db.delete(task).where(eq(task.parentId, taskId)); // sub-tasks first
	await db.delete(task).where(eq(task.id, taskId));
	broadcastProjectChange(projectId, actor.id);
	return ok(null);
```

`src/lib/server/tasks.ts` — `bulkDeleteTasks`:

```ts
	const allowed = await bulkAllowed(ids, projectId, actor);
	if (allowed.length === 0) return err(403, 'No deletable tasks selected');

	await db.delete(task).where(inArray(task.parentId, allowed)); // sub-tasks first
	await db.delete(task).where(inArray(task.id, allowed));

	broadcastProjectChange(projectId, actor.id);
	return ok({ deleted: allowed.length });
```

`src/routes/api/tasks/[id]/+server.ts` — REST DELETE **bypasses the service** and
inlines the delete (this is the odd one out; it does its own auth):

```ts
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');
	if (!(await canEditTask(locals.user, existing)))
		return apiError(403, 'No edit permission on this task');

	await db.delete(task).where(eq(task.parentId, params.id));
	await db.delete(task).where(eq(task.id, params.id));
	broadcastProjectChange(existing.projectId, locals.user.id);
	return new Response(null, { status: 204 });
};
```

**Project deletes (NO service exists — 4 inline sites):**

1. `src/routes/(app)/projects/[id]/+page.server.ts` — `deleteProject`:
   ```ts
   		await db.delete(project).where(eq(project.id, params.id));
   		broadcastProjectChange(params.id, locals.user.id);
   		redirect(303, '/projects');
   ```
2. `src/routes/(app)/projects/+page.server.ts` — `delete`:
   ```ts
   		await db.delete(project).where(eq(project.id, id));
   		return { success: true };
   ```
3. `src/routes/(app)/projects/[id]/settings/+page.server.ts` — `deleteProject`:
   ```ts
   		await db.delete(project).where(eq(project.id, params.id));
   		redirect(303, '/projects');
   ```
4. `src/routes/api/projects/[id]/+server.ts` — REST DELETE:
   ```ts
   	await db.delete(project).where(eq(project.id, params.id));
   	broadcastProjectChange(params.id, locals.user.id);
   	return new Response(null, { status: 204 });
   ```

### Upload storage layout (for the test)

`POST /api/tasks/[id]/files` (multipart, one field `file`) writes to
`UPLOADS_DIR/<projectId>/<uuid><ext>` and inserts a `file` row with
`taskId = <task>`, `projectId = <task's project>`, `fieldId = null`. So a
project's uploaded bytes all live under `UPLOADS_DIR/<projectId>/`. `UPLOADS_DIR`
default is `./data/uploads`.

## Commands you will need

| Purpose        | Command                     | Expected on success                    |
|----------------|-----------------------------|----------------------------------------|
| Typecheck      | `npm run check`             | exit 0, 0 errors, 0 warnings           |
| Unit tests     | `npm run test:unit`         | all pass (baseline: 416 tests)         |
| Integration    | `npm run test:integration`  | all pass (needs live server + seeded DB)|
| Start dev srv  | `npm run dev`               | serves on `http://localhost:5173`      |
| Seed DB        | `npm run db:seed`           | seeds admin/demo + sample data         |

## Scope

**In scope** (the only files you should modify):
- `src/lib/server/uploads.ts` (add two helpers)
- `src/lib/server/tasks.ts` (`deleteTaskService`, `bulkDeleteTasks`)
- `src/routes/api/tasks/[id]/+server.ts` (REST task DELETE)
- `src/routes/api/projects/[id]/+server.ts` (REST project DELETE)
- `src/routes/(app)/projects/[id]/+page.server.ts` (`deleteProject`)
- `src/routes/(app)/projects/+page.server.ts` (`delete`)
- `src/routes/(app)/projects/[id]/settings/+page.server.ts` (`deleteProject`)
- `tests/integration/delete-file-cleanup.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/lib/server/db/schema.sqlite.ts` / `schema.pg.ts` — NO schema change; the
  cascade stays. This is purely a disk-cleanup addition.
- `deleteFilesForField` and the single-file `DELETE /api/files/[id]` — they
  already unlink bytes correctly; leave them.
- Workspace deletion (`src/routes/(app)/workspaces/[id]/settings/+page.server.ts`)
  — a workspace can only be deleted when EMPTY (no projects), so it owns no files;
  do not add cleanup there.
- Do NOT remove the empty `<projectId>` directory after unlinking (an empty dir is
  harmless; `rmdir` adds failure modes for no benefit).

## Git workflow

- Work on branch `dev` (already the current branch).
- Commit style: conventional commits, e.g.
  `fix(uploads): unlink file bytes on task/project delete`.
- Commit after Step 1+2 (helpers + task sites), then after Step 3 (project sites),
  then the test — small, verifiable units.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add `deleteFilesForTasks` and `deleteFilesForProject` to `uploads.ts`

Add `inArray` to the `drizzle-orm` import, then add two helpers modeled on
`deleteFilesForField`:

```ts
/** Unlink + delete all file rows attached to any of these tasks. Call BEFORE
 *  deleting the tasks (the FK would cascade the rows away, orphaning the bytes). */
export async function deleteFilesForTasks(taskIds: string[]) {
	if (taskIds.length === 0) return;
	const rows = await db.select().from(file).where(inArray(file.taskId, taskIds));
	for (const f of rows) {
		try {
			await unlink(filePath(f.storagePath));
		} catch {
			// already gone — fine
		}
	}
	if (rows.length > 0) await db.delete(file).where(inArray(file.taskId, taskIds));
}

/** Unlink + delete every file row in a project (task attachments, custom-field
 *  uploads, project-level uploads). Call BEFORE deleting the project. */
export async function deleteFilesForProject(projectId: string) {
	const rows = await db.select().from(file).where(eq(file.projectId, projectId));
	for (const f of rows) {
		try {
			await unlink(filePath(f.storagePath));
		} catch {
			// already gone — fine
		}
	}
	if (rows.length > 0) await db.delete(file).where(eq(file.projectId, projectId));
}
```

**Verify**: `npm run check` → exit 0 (helpers unused so far; if `check` flags an
unused export it does NOT — exports are considered used. Proceed regardless.)

### Step 2: Wire task-deletion sites

**(2a)** In `src/lib/server/tasks.ts`, import the helper at the top:
`import { deleteFilesForTasks } from '$lib/server/uploads';` (match the existing
import style in that file — the others use `$lib/server/...`).

**(2b)** In `deleteTaskService`, gather the task + its sub-task ids and unlink
their files BEFORE the deletes:

```ts
	const subs = await db.select({ id: task.id }).from(task).where(eq(task.parentId, taskId));
	await deleteFilesForTasks([taskId, ...subs.map((s) => s.id)]);
	await db.delete(task).where(eq(task.parentId, taskId)); // sub-tasks first
	await db.delete(task).where(eq(task.id, taskId));
	broadcastProjectChange(projectId, actor.id);
	return ok(null);
```

**(2c)** In `bulkDeleteTasks`, do the same over `allowed` + their sub-tasks:

```ts
	const subs = await db.select({ id: task.id }).from(task).where(inArray(task.parentId, allowed));
	await deleteFilesForTasks([...allowed, ...subs.map((s) => s.id)]);
	await db.delete(task).where(inArray(task.parentId, allowed)); // sub-tasks first
	await db.delete(task).where(inArray(task.id, allowed));
```

(`inArray` is already imported in `tasks.ts`.)

**(2d)** Make the REST task DELETE inherit the cleanup by routing it through the
service (ADR-049: REST should be a thin adapter). In
`src/routes/api/tasks/[id]/+server.ts`, replace the inline delete + broadcast with
a `deleteTaskService` call. Keep the existing existence/access 404 semantics by
letting the service run after the same guards, OR simplify to:

```ts
export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [existing] = await db.select().from(task).where(eq(task.id, params.id));
	if (!existing) return apiError(404, 'Task not found');
	// ADR-019: inaccessible ≡ missing → 404, not 403
	if (!(await canAccessProject(locals.user, existing.projectId)))
		return apiError(404, 'Task not found');

	const res = await deleteTaskService(params.id, existing.projectId, locals.user);
	if (!res.ok) return apiError(res.status, res.message);
	return new Response(null, { status: 204 });
};
```

Add `deleteTaskService` to this file's imports from `$lib/server/tasks`. The
service already re-checks `canEditTask` and broadcasts, so remove the now-duplicate
inline `canEditTask` 403, the two `db.delete(task)` lines, and the
`broadcastProjectChange` call. Confirm `db`, `task`, `eq`, `canAccessProject` are
still imported/used (they are, for the existence lookup).

**Verify**: `npm run check` → exit 0, 0 errors / 0 warnings. `npm run test:unit`
→ all pass. Also confirm the existing REST task tests still pass in Step 5.

### Step 3: Wire the 4 project-deletion sites

In each of the four sites listed in "Current state", add
`await deleteFilesForProject(<projectId>);` on the line immediately BEFORE the
`await db.delete(project)...` call. Add
`import { deleteFilesForProject } from '$lib/server/uploads';` to each file (match
each file's existing import style).

- `src/routes/(app)/projects/[id]/+page.server.ts` (`deleteProject`): projectId is
  `params.id`.
- `src/routes/(app)/projects/+page.server.ts` (`delete`): projectId is the local
  `id`.
- `src/routes/(app)/projects/[id]/settings/+page.server.ts` (`deleteProject`):
  projectId is `params.id`.
- `src/routes/api/projects/[id]/+server.ts` (REST DELETE): projectId is `params.id`.

Example (site 4):

```ts
	await deleteFilesForProject(params.id);
	await db.delete(project).where(eq(project.id, params.id));
	broadcastProjectChange(params.id, locals.user.id);
	return new Response(null, { status: 204 });
```

**Verify**: `npm run check` → exit 0, 0 errors / 0 warnings.
`grep -rn "deleteFilesForProject" src/routes` → exactly 4 call sites (+ their
imports). `npm run test:unit` → all pass.

### Step 4 is intentionally merged into Step 3.

### Step 5: Add an integration test proving the bytes are removed

Create `tests/integration/delete-file-cleanup.test.ts`, modeled structurally on
`tests/integration/task-mutations.test.ts` (copy its `beforeAll` sign-in, `api()`
wrapper, `ensureAuth()`, `createProject`, `afterAll`). Because the integration
harness runs on the SAME host as the dev server, it can inspect `UPLOADS_DIR`
directly.

Add at the top:

```ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
const UPLOADS = process.env.UPLOADS_DIR ?? './data/uploads';
async function projectFiles(projectId: string): Promise<string[]> {
	try {
		return await readdir(join(UPLOADS, projectId));
	} catch {
		return []; // dir absent = no files
	}
}
```

Uploading needs multipart, so add a small helper (do NOT set `content-type` — let
`fetch` set the multipart boundary):

```ts
async function uploadToTask(taskId: string, name: string, bytes: string) {
	const fd = new FormData();
	fd.set('file', new File([bytes], name, { type: 'text/plain' }));
	return fetch(`${BASE}/api/tasks/${taskId}/files`, {
		method: 'POST',
		headers: { ...(cookie ? { cookie } : {}) },
		body: fd
	});
}
```

**Test A — project delete removes bytes:**
1. `createProject(...)` → projectId.
2. `POST /api/tasks` `{ projectId, title }` → taskId.
3. `uploadToTask(taskId, 'a.txt', 'hello')` → expect `res.status` 201.
4. `projectFiles(projectId)` → expect length ≥ 1 (a byte file exists on disk).
5. `DELETE /api/projects/{projectId}` → expect 204.
6. `projectFiles(projectId)` → expect length 0 (bytes unlinked).

**Test B — task delete removes its attachment bytes:**
1. New project + task, upload a file (as above), confirm `projectFiles` ≥ 1.
2. `DELETE /api/tasks/{taskId}` → expect 204.
3. `projectFiles(projectId)` → expect 0.
4. Clean up the project in `afterAll` (already handled by `createdProjectIds`).

Both tests would FAIL against the pre-fix code (the file would remain on disk).

**Verify**: with `npm run dev` running and DB seeded, `npm run test:integration`
→ all pass including both new tests.

## Test plan

- New file `tests/integration/delete-file-cleanup.test.ts`:
  - Test A: deleting a project unlinks its uploaded bytes (dir empties).
  - Test B: deleting a task unlinks its attachment bytes.
- Structural pattern to copy: `tests/integration/task-mutations.test.ts`.
- Existing REST task/project delete tests in `task-mutations.test.ts` must still
  pass (Step 2d refactored the REST task DELETE — confirm no regression: its
  `afterAll` deletes projects via `DELETE /api/projects/{id}`).
- Verification: `npm run test:integration` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run test:unit` exits 0 (416 tests still pass)
- [ ] `npm run test:integration` passes with both new tests present and passing
- [ ] `deleteFilesForTasks` + `deleteFilesForProject` exist in `uploads.ts`
- [ ] `grep -rn "deleteFilesForProject" src/routes` → 4 call sites
- [ ] `deleteTaskService` + `bulkDeleteTasks` call `deleteFilesForTasks` before
      their `db.delete(task)` calls
- [ ] The REST task DELETE no longer inlines `db.delete(task)` — it calls
      `deleteTaskService` (`grep -n "db.delete(task)" src/routes/api/tasks/[id]/+server.ts`
      returns nothing)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any "Current state" excerpt doesn't match the live code (drift) — especially if
  a project-delete SERVICE has since been introduced (then wire the helper into
  the service instead of the 4 inline sites, and report the change of approach).
- `npm run check` fails after Step 2d because the REST DELETE refactor left an
  unused import or a type mismatch on `deleteTaskService`'s signature — fix the
  import, but if the signature differs from `(taskId, projectId, actor)` shown in
  "Current state", STOP and report.
- The upload in Step 5 does not create a file under `UPLOADS_DIR/<projectId>/`
  (e.g. `UPLOADS_DIR` points elsewhere in this environment) — report the actual
  `UPLOADS_DIR` before adjusting the test path.
- The integration tests can't reach the server (SKIP) — you still must run
  `npm run check` + `npm run test:unit` and report that the integration tests were
  skipped for lack of a live server.

## Maintenance notes

- If a new upload surface is added that stores files under a DIFFERENT key than
  `file.projectId` / `file.taskId`, `deleteFilesForProject` (which keys on
  `projectId`) still covers it as long as `file.projectId` is set — keep the
  `projectId` NOT NULL invariant.
- A reviewer should confirm the unlink runs BEFORE the DB delete at every site
  (after the cascade fires, the `storagePath` is gone and the bytes are
  unrecoverable), and that the REST task DELETE refactor preserved the 404-not-403
  access semantics (ADR-019).
- Deferred: this plan does not retro-clean bytes already orphaned before the fix.
  A one-off sweep (list `UPLOADS_DIR` files, delete any whose `storagePath` has no
  matching `file` row) can be a separate maintenance script — out of scope here.
