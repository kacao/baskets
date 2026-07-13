# Plan 012: Add ESLint + Prettier + EditorConfig with lint/format scripts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- package.json`
> Also re-run the "no config exists" checks in Current state; if any linter
> config already exists, treat it as a STOP condition (someone started this).

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The repo has NO linter or formatter: only `check` (svelte-check) exists. There
is no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `.editorconfig`, or
`.husky/`, and no `lint`/`format` npm scripts. Style is enforced only by
convention (tabs, single quotes). Adding ESLint + Prettier gives a mechanical
gate for correctness-adjacent bugs (unused vars, floating promises) and
consistent formatting, and unblocks a `lint` step in CI (Plan 004). The RISK is
the first repo-wide `prettier --write`: it touches almost every file and will
conflict badly with any in-flight branch — so config lands FIRST, and the
reformat is a SEPARATE, explicitly-coordinated commit.

## Current state

- `package.json` scripts (only quality gate is `check`):

```json
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
```

- No lint/format tooling present. Verify all of these return nothing/error:
  - `ls -la | grep -iE "eslint|prettier|editorconfig|husky"` → (empty)
  - `ls .husky` → No such file or directory
- Stack: SvelteKit 2 + **Svelte 5 runes**, TypeScript, ESM
  (`"type": "module"` in package.json). Svelte version `^5.28.0`.
- Repo style (must be preserved by Prettier config): **tabs** for indentation,
  **single quotes**. Confirm from any source file, e.g.
  `src/lib/server/db/index.ts` uses tab indent + single quotes.
- Node 22.

## Commands you will need

| Purpose                 | Command                | Expected on success                                              |
| ----------------------- | ---------------------- | ---------------------------------------------------------------- |
| Install a dep           | `npm install -D <pkg>` | exit 0                                                           |
| Lint                    | `npm run lint`         | exit 0 (after config scoped so pre-existing issues are warnings) |
| Format check            | `npm run format:check` | exit 0 after the reformat commit                                 |
| Format write            | `npm run format`       | rewrites files                                                   |
| Typecheck (unaffected)  | `npm run check`        | exit 0                                                           |
| Unit tests (unaffected) | `npm run test:unit`    | all pass                                                         |

## Scope

**In scope** (create/modify):

- `package.json` — add devDeps + `lint`, `format`, `format:check` scripts.
- `eslint.config.js` (flat config — ESLint 9 style).
- `.prettierrc` (or `.prettierrc.json`).
- `.prettierignore`
- `.editorconfig`
- `.eslintignore` is NOT used with flat config — use an `ignores` entry instead.
- (Optional) `.husky/` + lint-staged wiring — only if Step 5 is done.
- The repo-wide reformat diff (Step 4) — a SEPARATE commit.

**Out of scope** (do NOT touch semantics):

- Any behavioral change to `src/` beyond pure formatting.
- `tsconfig.json`, `svelte.config.js`, vite configs (unless ESLint plugin setup
  strictly requires a parser reference — keep such changes minimal and noted).

## Git workflow

- Branch: `advisor/012-lint-format`.
- **Two commits, in order**:
  1. `chore(dx): add eslint + prettier + editorconfig config and scripts`
     (config + scripts + deps ONLY — no reformat).
  2. `style: apply prettier --write across the repo` (the reformat, nothing else).
- Do NOT push or open a PR unless the operator instructed it.
- Before starting, ensure the working tree is clean (`git status`) so the
  reformat commit contains only formatting.

## Steps

### Step 1: Install dependencies

```
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-svelte \
  prettier prettier-plugin-svelte
```

(Optional, only if you also do the Tailwind class sorting: add
`prettier-plugin-tailwindcss`. Skip if unsure — it reorders class attributes and
enlarges the diff.)

**Verify**: `npx eslint --version` prints a 9.x version; `npx prettier --version`
prints a 3.x version.

### Step 2: Add config files

**`.prettierrc`** — must match repo style (tabs, single quotes):

```json
{
	"useTabs": true,
	"singleQuote": true,
	"trailingComma": "none",
	"printWidth": 100,
	"plugins": ["prettier-plugin-svelte"],
	"overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }]
}
```

**`.prettierignore`**:

```
build/
.svelte-kit/
node_modules/
static/heroicons.svg
data/
tests/webwright/
package-lock.json
```

**`.editorconfig`**:

```
root = true

[*]
indent_style = tab
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false

[*.{yml,yaml,json}]
indent_style = space
indent_size = 2
```

**`eslint.config.js`** (flat config; keep rules PERMISSIVE initially so a huge
pre-existing backlog doesn't block the gate — noisy rules as `warn`, real bugs
as `error`):

```js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default [
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'node_modules/',
			'static/heroicons.svg',
			'data/',
			'tests/webwright/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: { parserOptions: { projectService: true, extraFileExtensions: ['.svelte'] } },
		rules: {
			// Start permissive: pre-existing code should not fail the gate.
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'off',
			'no-undef': 'off'
		}
	}
];
```

**Verify**: `npx eslint --print-config package.json > /dev/null` → exit 0
(config parses).

### Step 3: Add npm scripts

Add to `package.json` `scripts`:

```json
"lint": "eslint .",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

**Verify**: `npm run lint` runs to completion. If it reports hundreds of ERRORS
(not warnings), STOP — see STOP conditions and downgrade the offending rules to
`warn` before proceeding. Goal: `npm run lint` exits 0 (warnings allowed).

### Step 4: The repo-wide format pass (SEPARATE commit)

Only after Steps 1–3 are committed:

1. Confirm the working tree is clean (`git status`).
2. Run `npm run format`.
3. Review the diff is formatting-only (`git diff --stat` — expect many files,
   whitespace/quote changes only; spot-check 2–3 files that no logic changed).
4. Commit as `style: apply prettier --write across the repo`.

**Verify**: `npm run format:check` → exit 0. Then re-run the safety nets:
`npm run check` → exit 0; `npm run test:unit` → all pass. (Formatting must not
change behavior — if a test now fails, the reformat broke something; STOP.)

### Step 5 (OPTIONAL): pre-commit hook

If a lightweight pre-commit gate is wanted:

```
npm install -D husky lint-staged
npx husky init
```

Set `.husky/pre-commit` to `npx lint-staged`, and add to `package.json`:

```json
"lint-staged": {
	"*.{ts,js,svelte,json,css,md}": "prettier --check",
	"*.{ts,svelte}": "svelte-check --tsconfig ./tsconfig.json --no-tsconfig || true"
}
```

Skip this step entirely if the operator hasn't asked for hooks — it changes
local dev ergonomics.

**Verify** (if done): a trivial staged change triggers `lint-staged` on commit.

## Test plan

No new automated tests. Verification is:

- `npm run lint` exits 0 (warnings permitted).
- `npm run format:check` exits 0 after the reformat commit.
- `npm run check` and `npm run test:unit` still pass (formatting changed nothing
  functionally).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run lint` exists and exits 0.
- [ ] `npm run format:check` exists and exits 0 (post-reformat).
- [ ] `.editorconfig`, `.prettierrc`, `.prettierignore`, `eslint.config.js` exist.
- [ ] `npm run check` exits 0 and `npm run test:unit` passes (unchanged behavior).
- [ ] The reformat is a SEPARATE commit from the config commit
      (`git log --oneline -3` shows two distinct commits).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run lint` surfaces hundreds of pre-existing **errors** — downgrade those
  specific rules to `warn` in `eslint.config.js`, record the count in your
  report as a backlog, and do NOT mass-edit source to satisfy them.
- The `prettier --write` diff shows any NON-formatting change (logic moved,
  strings altered) — STOP; something is misconfigured.
- `npm run check` or `npm run test:unit` starts failing after the reformat —
  STOP; the format pass must be behavior-preserving.
- A linter config already exists on the branch (drift) — STOP; do not clobber it.
- The working tree was not clean before Step 4 — STOP; coordinate so the
  reformat commit isn't entangled with feature work.

## Maintenance notes

- Coordinate the Step-4 reformat with any open feature branch (the plan author
  noted uncommitted work in `src/lib/server/tasks.ts` and
  `src/lib/components/TaskPanel.svelte` at planning time) — reformatting a file
  with pending edits guarantees a merge conflict. Rebase/merge those first.
- Once the backlog of `warn`s is burned down, promote key rules
  (`no-unused-vars`, `no-floating-promises` if type-aware linting is enabled)
  from `warn` to `error`.
- Plan 004 should add `npm run lint` + `npm run format:check` steps once this
  lands.
- A reviewer should scrutinize the config commit (rule choices) closely and the
  reformat commit only for accidental non-format changes.
