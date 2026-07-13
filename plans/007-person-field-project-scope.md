# Plan 007: Scope `person` custom-field values to the project's access roster

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- src/lib/server/customFields.ts`
> If `src/lib/server/customFields.ts` changed since this plan was written,
> compare the "Current state" excerpt against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

A `person`-type custom field stores user ids. When a value is written, the server
validates each id — but for `person` it validates only that the id exists in the
GLOBAL `user` table, with NO project-membership check. So a member who can edit a
task in project A can store `person:<any-user-id>` (a user who has nothing to do
with project A) and then read that user's real name back — e.g. via the CSV export
endpoint, which resolves user ids to names globally. That is a cross-project
user-name disclosure: the app's whole access model (ADR-019) is "visibility =
access; don't leak the full user roster to every project member," and this write
path silently violates it. The `place` branch right below already scopes to the
project, and `notifyMentions` already intersects person refs with the project's
access roster — this plan makes `person` custom-field writes do the same.

## Current state

- `src/lib/server/customFields.ts` — the ONE validated write path for custom-field
  values (`writeTaskCustomValues` / `writeProjectCustomValues`, both calling the
  private `encodeAndValidate`). Used by the task/project form actions AND REST.
- `src/lib/server/permissions.ts` exports the roster helper to reuse:

  ```ts
  export async function projectAccessUserIds(
  	projectId: string,
  	workspaceId: string | null
  ): Promise<Set<string>>
  ```

  It returns admins + the workspace owner + workspace grantees + direct project
  grantees. `notifyMentions` (`src/lib/server/mentions.ts` lines 39–45) already
  uses it exactly this way:

  ```ts
  	const [proj] = await db
  		.select({ workspaceId: project.workspaceId })
  		.from(project)
  		.where(eq(project.id, opts.projectId));
  	const allowed = await projectAccessUserIds(opts.projectId, proj?.workspaceId ?? null);
  	const targets = fresh.filter((id) => allowed.has(id));
  ```

### The vulnerable validation, inside `encodeAndValidate` (`customFields.ts`):

```ts
		let valid: Set<string>;
		if (type === 'select') {
			const opts = await db
				.select({ id: customFieldOption.id })
				.from(customFieldOption)
				.where(eq(customFieldOption.fieldId, field.id));
			valid = new Set(opts.map((o) => o.id));
		} else if (type === 'person') {
			const us = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
			valid = new Set(us.map((u) => u.id));
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
```

The `person` branch is the only one that does not constrain `ids` to the project.
The fix is to intersect the referenced ids with `projectAccessUserIds(projectId, workspaceId)`.

`encodeAndValidate(field, raw, projectId)` receives `projectId` but not the
workspace id, so we must look up the project's `workspaceId` inside the `person`
branch (mirroring `notifyMentions`).

### Header of `customFields.ts` (imports to extend):

```ts
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './db';
import {
	customField,
	customFieldOption,
	file,
	location,
	projectCustomValue,
	task,
	taskCustomValue,
	user
} from './db/schema';
```

`project` is NOT currently imported here, nor is `projectAccessUserIds`.

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
- `src/lib/server/customFields.ts`
- `tests/integration/person-field-scope.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/lib/server/permissions.ts` — reuse `projectAccessUserIds` as-is; do not
  change its signature.
- The `place`/`task`/`files`/`select` branches — they are already project-scoped.
- The CSV export endpoint (`src/routes/api/projects/[id]/export/+server.ts`) —
  the fix is on WRITE validation, not on read/export. (Pre-existing stored values
  that already violate the rule are decoded leniently elsewhere and are out of
  scope; do not attempt a data migration here.)
- `writeProjectCustomValues` — it calls the same `encodeAndValidate`, so it
  inherits the fix automatically; no separate change needed. A `person` project
  field (if any) will also be scoped correctly.

## Git workflow

- Work on branch `dev` (already the current branch).
- Commit style: conventional commits, e.g.
  `fix(custom-fields): scope person values to the project access roster`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Import the roster helper and the `project` table

At the top of `customFields.ts`:

- Add `project` to the existing `./db/schema` import.
- Add `import { projectAccessUserIds } from './permissions';`

**Verify**: `npm run check` → exit 0 (the imports are unused so far — if `check`
flags an unused import, proceed to Step 2 which uses both, then re-run).

### Step 2: Constrain the `person` branch to the project's access roster

Replace the `person` branch inside `encodeAndValidate`:

```ts
		} else if (type === 'person') {
			const us = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
			valid = new Set(us.map((u) => u.id));
		} else if (type === 'place') {
```

with a version that first resolves the project's workspace, then intersects the
existing-user set with the project's access roster:

```ts
		} else if (type === 'person') {
			// person ids must be REAL users AND able to access this project — otherwise a
			// task editor could store an arbitrary user's id and read their name back via
			// CSV export (cross-project disclosure). Mirrors notifyMentions' scoping.
			const [proj] = await db
				.select({ workspaceId: project.workspaceId })
				.from(project)
				.where(eq(project.id, projectId));
			const roster = await projectAccessUserIds(projectId, proj?.workspaceId ?? null);
			const us = await db.select({ id: user.id }).from(user).where(inArray(user.id, ids));
			valid = new Set(us.map((u) => u.id).filter((id) => roster.has(id)));
		} else if (type === 'place') {
```

The trailing `if (!ids.every((id) => valid.has(id))) return { error: ... }` check
(unchanged, below) now rejects the whole write with the existing
`'Invalid reference in custom field'` message when any id is off-roster.

**Verify**: `npm run check` → exit 0, 0 errors / 0 warnings. `npm run test:unit`
→ all pass (these are pure-module tests; `encodeAndValidate` is DB-backed so it's
covered by integration, not unit — a pass here just confirms nothing else broke).

### Step 3: Add an integration test proving off-roster ids are rejected

Create `tests/integration/person-field-scope.test.ts`, modeled structurally on
`tests/integration/task-mutations.test.ts` (copy its `beforeAll` sign-in, `api()`
wrapper, `ensureAuth()`, `createProject`, and `afterAll` cleanup). The seeded
admin is on every project's roster (admins are always included), so to test the
NEGATIVE case we need an id that is a real user but NOT on the project roster.

The seed (`scripts/seed.ts`) creates an admin AND a demo user. Because the admin
is signing in and admins access all projects, the demo user is NOT automatically
on a brand-new project's roster unless granted. Use the demo user's id as the
off-roster id.

Test outline:

1. Find the demo user's id. There is no "list users" REST endpoint (by design).
   Obtain it indirectly: create a project, then read `GET /api/projects/{id}` —
   if the demo id isn't discoverable that way, instead assert with a **random
   UUID** that is definitely not a real user (this still exercises the fix,
   because a random UUID is neither a real user NOR on the roster — the pre-fix
   code ALSO rejected it, so it is a weaker test). PREFER a real off-roster user
   id if you can obtain one; otherwise document in the test comment that the
   random-UUID case only proves "unknown id rejected," and add a POSITIVE case
   (below) which is the load-bearing assertion.
2. Create a project. Create a `person` custom field on it via
   `POST /api/projects/{id}/custom-fields` `{ name, type: 'person' }` (verify the
   endpoint's exact body by reading
   `src/routes/api/projects/[id]/custom-fields/+server.ts`).
3. Create a task in the project.
4. **Negative**: `PATCH /api/tasks/{taskId}` with
   `{ customFields: { [fieldId]: [offRosterUserId] } }` → expect status **400**
   and, on a follow-up `GET /api/tasks/{taskId}`, the field is unset/empty (the
   off-roster id was NOT persisted).
5. **Positive** (proves the fix didn't over-block): `PATCH /api/tasks/{taskId}`
   with `{ customFields: { [fieldId]: [<admin's own id>] } }` → expect **200**
   and the value persisted. Get the admin's own id from `GET /api/me`
   (`{ user: { id } }`).

The positive case is essential: it guarantees the roster intersection allows a
legitimate, on-roster user (the signed-in admin) and that the fix isn't a blanket
rejection.

**Verify**: with `npm run dev` running and DB seeded, `npm run test:integration`
→ all pass including the new test.

## Test plan

- New file `tests/integration/person-field-scope.test.ts`:
  - Negative: writing an off-roster `person` id (a real non-member user id if
    obtainable, else a random UUID) is rejected (400, not persisted).
  - Positive: writing the signed-in admin's own id (on the roster) succeeds (200,
    persisted) — proves no over-blocking.
- Structural pattern to copy: `tests/integration/task-mutations.test.ts`.
- Verification: `npm run test:integration` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run test:unit` exits 0 (416 tests still pass)
- [ ] `npm run test:integration` passes with the new test present and passing
- [ ] The `person` branch in `encodeAndValidate` calls
      `projectAccessUserIds(...)` (`grep -n "projectAccessUserIds" src/lib/server/customFields.ts`
      returns a match)
- [ ] `project` is imported from `./db/schema` in `customFields.ts`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `encodeAndValidate` `person` branch doesn't match the "Current state"
  excerpt (drift).
- `projectAccessUserIds` is not exported from `src/lib/server/permissions.ts`
  with the `(projectId, workspaceId)` signature shown (the helper was renamed or
  moved — do not reimplement it here; report).
- The positive test case (admin's own id) is rejected — that means the roster
  intersection is wrong (admins should always be on the roster); report before
  loosening it.
- Custom-field creation via REST requires a shape you can't determine from the
  route file — report rather than guessing the request body.

## Maintenance notes

- If a future feature lets a `person` field intentionally reference users OUTSIDE
  the project roster (e.g. an org-wide directory field), that must be an explicit,
  separate decision (new field config flag + ADR) — not a silent widening of this
  check.
- A reviewer should confirm the fix is on the WRITE path (so it also covers the
  REST `customFields` map via `apiCustomFieldEntries`) and that the `place`/`task`/
  `files` branches were left untouched.
- Deferred: any pre-existing stored off-roster `person` values are not migrated by
  this plan; if that matters, a follow-up cleanup pass over `task_custom_value` /
  `project_custom_value` can strip off-roster ids — out of scope here.
