# Plan 013: Document the project-grants and project-statuses REST endpoints in llms.txt

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- static/llms.txt src/routes/api/projects/[id]/grants/ src/routes/api/projects/[id]/statuses/`
> If either route file changed, re-read it and reconcile the params/response
> shapes below before writing.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

`static/llms.txt` is the machine-readable REST API contract served at `/llms.txt`
for agent consumers, and AGENTS.md mandates keeping it updated for any REST
change. Two live endpoints are under-documented: `/api/projects/{id}/grants`
(GET/POST/DELETE) is **entirely absent** (`grep "projects/{id}/grants"
static/llms.txt` → 0 matches), and `/api/projects/{id}/statuses` (GET/POST/PATCH)
is only name-dropped in prose (line 117) with no request/response block. An agent
reading llms.txt cannot manage project grants or project statuses via the API
even though the endpoints exist. This plan adds both blocks, mirroring the
existing workspace-grants and workspace-statuses sections' exact style.

## Current state

### The two undocumented routes

`src/routes/api/projects/[id]/grants/+server.ts` exports GET/POST/DELETE:
- **GET** — admin only (`403 "Only admins can view project grants"`); `404` if
  project missing. Returns `{ grants: [{ id, userId, userName, resourceType,
  resourceId }...] }` (grants/grants.ts:19-26, 28-37).
- **POST** — admin only (`403 "Only admins can grant permissions"`); `404` if
  missing. Body: `userId` (string, required), optional `resourceType`
  (`'project'` default | `'view'`), optional `resourceId` (defaults to the
  project id; for a `view` grant it must be a view of THIS project). Errors:
  `400 "Invalid grant"`, `400 "Invalid view"`, `400 "Unknown user"`. Idempotent
  (`onConflictDoNothing`). Returns `201 { grants: [...] }` (grants.ts:39-84).
- **DELETE** — admin only (`403 "Only admins can revoke permissions"`); `404` if
  missing. Identify the grant by `grantId` OR `userId` (JSON body or query
  string `?grantId=`/`?userId=`); `400 "Provide grantId or userId"` if neither;
  `404 "Grant not found"` if the grantId isn't in this project's grant set.
  Returns `204` empty (grants.ts:86-121).

`src/routes/api/projects/[id]/statuses/+server.ts` exports GET/POST/PATCH:
- **GET** — access-gated (`404` if inaccessible/missing). Returns
  `{ statuses: [<status>...] }` = the project's eligible statuses in global
  order (statuses/statuses.ts:16-27).
- **POST** — needs project edit (`404` if inaccessible, `403 "No edit permission
  on this project"`). Body: `name` (required), `description` (string|null),
  `category` (default `'backlog'`), `color`, `icon`. Returns
  `201 { status: <status> }` (statuses.ts:29-57).
- **PATCH** — needs project edit (same 404/403). Body: `statusIds` (array of
  status ids — sets the eligible set) and/or `order` (array of status ids —
  reorders this project's CUSTOM statuses); `400 "Provide statusIds and/or
  order"` if neither; `400` if either is not an array of strings. Returns
  `{ statuses: [<status>...] }` (statuses.ts:63-99).

### The style to mirror (existing sections in llms.txt)

Workspace grants (llms.txt:102-113):

```
### GET /api/workspaces/{id}/grants
List the workspace's permission grants. Managed by ADMINS or the workspace OWNER only.
- 200: `{ "grants": [{ "id", "userId", "userName", "resourceType" ("workspace"), "resourceId" }...] }`. `404` if inaccessible; `403 "Only admins or the owner can view workspace grants"` for accessible non-managers.

### POST /api/workspaces/{id}/grants
Grant a user access to the workspace (admin or owner).
- Body: `userId` string, required (`400 "Invalid grant"` if missing, `400 "Unknown user"` if no such user). Idempotent (conflicts are ignored).
- 201: `{ "grants": [...] }` (the updated list). `404`/`403` as above.

### DELETE /api/workspaces/{id}/grants
Revoke a grant (admin or owner). Identify it by `grantId` OR `userId`, via JSON body or query string (`?grantId=` / `?userId=`); `400 "Provide grantId or userId"` if neither.
- 204: empty body. `404`/`403` as above.
```

Workspace statuses (llms.txt:70-82):

```
### GET /api/workspaces/{id}/statuses
List the workspace's own custom statuses (access only).
- 200: `{ "statuses": [<status>...] }`. `404` if inaccessible.

### POST /api/workspaces/{id}/statuses
...
- Body: `name` (required, trimmed, max 40), `description` (string|null, max 200), `category` (one of the status categories, default `backlog`; `400` otherwise), `color` (`#rrggbb` hex or null), `icon` (emoji or `iconoir:<name>`, else null). ...

### PATCH /api/workspaces/{id}/statuses
Reorder the workspace's custom statuses.
...
- 200: `{ "statuses": [<status>...] }`.
```

The `## Statuses` section header + intro is at llms.txt:115-117:

```
## Statuses

Status definitions are table-driven and scoped (built-in app-wide / workspace / project). Create workspace statuses via `POST /api/workspaces/{id}/statuses`, project statuses via `POST /api/projects/{id}/statuses`. The endpoints below edit/delete an existing status by id.
```

File length: 596 lines. Repo convention: Markdown `###` per endpoint, backtick
JSON shapes, error codes inline as shown above.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm grants absent (before) | `grep -c "projects/{id}/grants" static/llms.txt` | `0` |
| Confirm grants present (after) | `grep -c "projects/{id}/grants" static/llms.txt` | `3` (GET/POST/DELETE headers) |
| Confirm project statuses block | `grep -c "/api/projects/{id}/statuses" static/llms.txt` | `≥3` |

## Scope

**In scope** (modify only):
- `static/llms.txt`

**Out of scope** (do NOT touch):
- The route files under `src/routes/api/projects/[id]/` — this is a docs-only
  change; you are documenting them, not changing them.
- Any other section of llms.txt beyond inserting the two new blocks.

## Git workflow

- Branch: `advisor/013-llms-txt-project-grants`.
- Commit: `docs(llms): document project grants + project statuses REST endpoints`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the project-grants block

Find where project-scoped endpoints are documented. Add a new subsection (three
`###` blocks) for project grants, mirroring the workspace-grants style. Place it
near the other `/api/projects/{id}/...` endpoints; if there is a project section,
append there — otherwise place it immediately after the workspace-grants block
(llms.txt:113) so grants stay together. Use this content:

```
### GET /api/projects/{id}/grants
List a project's permission grants. ADMIN only.
- 200: `{ "grants": [{ "id", "userId", "userName", "resourceType" ("project"|"view"), "resourceId" }...] }`. `403 "Only admins can view project grants"` for non-admins; `404 "Project not found"` if missing.

### POST /api/projects/{id}/grants
Grant a user access to the project (or to a specific view of it). ADMIN only.
- Body: `userId` string, required. Optional `resourceType` (`"project"` default | `"view"`) and `resourceId` (defaults to `{id}`; a `view` grant's `resourceId` must be a view of this project). Errors: `400 "Invalid grant"`, `400 "Invalid view"`, `400 "Unknown user"`. Idempotent (conflicts ignored).
- 201: `{ "grants": [...] }` (the updated list). `403` for non-admins; `404 "Project not found"` if missing.

### DELETE /api/projects/{id}/grants
Revoke a grant. ADMIN only. Identify it by `grantId` OR `userId`, via JSON body or query string (`?grantId=` / `?userId=`); `400 "Provide grantId or userId"` if neither; `404 "Grant not found"` if the grantId isn't part of this project's grant set.
- 204: empty body. `403` for non-admins; `404 "Project not found"` if missing.
```

**Verify**: `grep -c "projects/{id}/grants" static/llms.txt` → `3`.

### Step 2: Add the full project-statuses block

In the `## Statuses` section (or near the project endpoints), add a full block
for the three project-statuses methods, mirroring the workspace-statuses style:

```
### GET /api/projects/{id}/statuses
List the project's eligible (assignable-on-tasks) statuses, in global order. Access only.
- 200: `{ "statuses": [<status>...] }`. `404` if inaccessible/missing.

### POST /api/projects/{id}/statuses
Create a PROJECT-scoped status (auto-eligible for this project). Needs project edit.
- Body: `name` (required, trimmed, max 40), `description` (string|null, max 200), `category` (one of the status categories, default `backlog`), `color` (`#rrggbb` hex or null), `icon` (emoji or `iconoir:<name>`, else null). `400` on a name collision with defaults/workspace/project siblings.
- 201: `{ "status": <status> }`. `404` if inaccessible/missing; `403 "No edit permission on this project"` otherwise.

### PATCH /api/projects/{id}/statuses
Set the eligible status id set and/or reorder this project's custom statuses. Needs project edit.
- Body: `statusIds` (array of status ids — the eligible set) and/or `order` (array of status ids — reorder this project's custom statuses; positions only). `400 "Provide statusIds and/or order"` if neither; `400` if either is not an array of strings.
- 200: `{ "statuses": [<status>...] }`. `404` if inaccessible/missing; `403 "No edit permission on this project"` otherwise.
```

Keep the `<status>` object shape reference consistent with how the file already
refers to it (it uses `<status>` shorthand, e.g. line 72). Do not redefine the
status object here.

**Verify**: `grep -c "/api/projects/{id}/statuses" static/llms.txt` → `≥3`.

### Step 3: Cross-check the wording against the routes

Re-open both `+server.ts` files and confirm every error string and field name in
your new text matches the code (e.g. `"No edit permission on this project"`,
`"Provide statusIds and/or order"`, `"Only admins can view project grants"`).
Fix any mismatch.

**Verify**: `npm run check` → exit 0 (llms.txt is static, but running check
confirms you didn't accidentally edit a `.ts`/`.svelte` file).

## Test plan

Docs-only; no automated tests. Verification is the greps above plus a manual
read confirming the two blocks match the workspace-section formatting.

Optional follow-up (recommend in your report, do NOT implement here unless the
operator asks): a tiny CI check that diffs the set of `+server.ts` route files
under `src/routes/api/**` against the `###` endpoint headers in `static/llms.txt`
to catch future drift.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "projects/{id}/grants" static/llms.txt` → `3`.
- [ ] `grep -c "/api/projects/{id}/statuses" static/llms.txt` → `≥3`.
- [ ] Error strings in the new blocks match the route source (spot-check 3).
- [ ] Only `static/llms.txt` is modified (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Either route file's methods/params/error strings differ from the "Current
  state" excerpts (drift) — reconcile from the live route, not this plan.
- A project-grants or project-statuses block already exists in llms.txt (someone
  added it) — STOP; do not duplicate.

## Maintenance notes

- Any future change to these two route files' request/response shapes must
  update these blocks (AGENTS.md rule: keep llms.txt current).
- The recommended CI drift-check (route files ↔ llms.txt headers) would prevent
  this class of omission recurring; propose it separately.
