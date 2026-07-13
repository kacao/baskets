# Plan 015: Add coverage reporting and the first component/DOM test (MentionEditor)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- vitest.config.ts tests/setup.ts src/lib/components/MentionEditor.svelte package.json`
> The plan author noted uncommitted work in `src/lib/components/TaskPanel.svelte`
> at planning time; MentionEditor is a sibling. If MentionEditor's props changed,
> reconcile against the excerpt below before writing the render test.

## Status

- **Priority**: P3
- **Effort**: M–L
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The devDependencies already include `@testing-library/svelte` and
`@testing-library/jest-dom`, and `tests/setup.ts` imports the jest-dom matchers —
but there are ZERO component tests (`find src tests -name "*.svelte.test.ts"`
returns nothing) and NO coverage instrumentation (no `@vitest/coverage-v8` dep,
no `coverage` block in `vitest.config.ts`). So the contenteditable
`MentionEditor.svelte` (a subtle WYSIWYG editor) and the ~2000-line project page
/ TaskPanel are verified only by the 11 manual-server e2e tests. The PRD's
"Future candidates" explicitly names this gap:

> "Broader automated test coverage — a **vitest** unit suite (`tests/unit/`) plus
> integration/e2e harnesses exist; expand them (e.g. component/DOM tests for the
> contenteditable mention editor)" — `PRD.md:112`

This plan (1) turns on coverage so we get a baseline, and (2) writes the first
`*.svelte.test.ts` rendering `MentionEditor` to cover its DOM-interaction layer
(the pure helpers — `linkify`/`detectQuery` — are already unit-tested in
`tests/unit/mentionsLinkify.test.ts` / `mentionsDetectQuery.test.ts`, so this
covers what those cannot: the rendered `@`-picker behavior).

## Current state

- `vitest.config.ts` (verbatim) — jsdom env, SvelteKit plugin, no coverage:

```ts
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		include: ['src/**/*.{test,spec}.ts', 'tests/unit/**/*.{test,spec}.ts'],
		exclude: ['tests/e2e/**', 'node_modules/**', 'build/**', '.svelte-kit/**']
	}
});
```

Note the `include` matches `*.{test,spec}.ts` — a `*.svelte.test.ts` file DOES
match `*.test.ts`, so no include change is needed to pick up the new file.

- `tests/setup.ts` (verbatim): `import '@testing-library/jest-dom/vitest';`
- Relevant devDeps present: `@testing-library/svelte ^5.2.6`,
  `@testing-library/jest-dom ^6.6.3`, `jsdom ^25.0.1`, `svelte ^5.28.0`,
  `vitest ^3.0.0`. **Missing**: `@vitest/coverage-v8`.
- `MentionEditor.svelte` is a Svelte 5 runes component. Its props
  (`src/lib/components/MentionEditor.svelte:22-70`):

```ts
let {
	value = $bindable(''),
	name,
	id,
	rows = 4,
	placeholder = '',
	ariaLabel,
	disabled = false,
	class: klass = '',
	onblur,
	onkeydown,
	onSelectTask,
	projectId,
	canEditProject = false,
	excludeTaskId,
	tasks = [],
	locations = [],
	files = [],
	projects = [],
	people = [],
	fields = [],
	fieldOptions = [],
	fieldValues = []
}: {
	value?: string;
	name?: string;
	// ...
	onSelectTask?: (id: string) => void;
	tasks?: { id: string; title: string }[];
	locations?: { id: string; title: string; address?: string | null }[];
	files?: { id: string; filename: string; mimeType?: string }[];
	projects?: { id: string; name: string }[];
	people?: { id: string; name: string | null; email?: string | null }[];
	// ...
} = $props();
```

Behavior relevant to a DOM test: it renders a `contenteditable` editor;
typing `@` opens a caret-anchored picker (`query` bound to a search input,
see MentionEditor.svelte:603); selecting a candidate inserts a token
`@[label](kind:id)` into `value`; a hidden `<input name={name} value={value}>`
is emitted when `name` is set (MentionEditor.svelte:588); paste is forced to
plain text; `value` serializes the DOM. `value` uses the plain-text token
format `@[label](kind:id)`.

- Testing rules (repo): Arrange-Act-Assert; test behavior not implementation;
  sentence-style test names.

## Commands you will need

| Purpose                | Command                                                          | Expected on success                |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| Install coverage dep   | `npm install -D @vitest/coverage-v8`                             | exit 0                             |
| Coverage run           | `npm run test:coverage`                                          | produces a coverage report, exit 0 |
| Run the component test | `npx vitest run src/lib/components/MentionEditor.svelte.test.ts` | pass                               |
| Full unit suite        | `npm run test:unit`                                              | all pass                           |
| Typecheck              | `npm run check`                                                  | exit 0                             |

## Scope

**In scope** (create/modify):

- `package.json` — add `@vitest/coverage-v8` devDep + a `test:coverage` script.
- `vitest.config.ts` — add a `coverage` block.
- `src/lib/components/MentionEditor.svelte.test.ts` — the first component test.
- `.gitignore` — add `coverage/` if not already ignored.

**Out of scope** (do NOT modify):

- `MentionEditor.svelte` itself — this plan TESTS it, does not change it. If a
  test can't drive it without a source change, STOP and report.
- The e2e tests / TaskPanel / project page — later, larger work.
- The pure mention helpers in `src/lib/mentions.ts` — already unit-tested.

## Git workflow

- Branch: `advisor/015-component-tests-coverage`.
- Commit: `test(components): add coverage reporting + first MentionEditor DOM test`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add coverage instrumentation

```
npm install -D @vitest/coverage-v8
```

Add a `coverage` block to `vitest.config.ts` `test`:

```ts
coverage: {
	provider: 'v8',
	reporter: ['text', 'html'],
	include: ['src/**/*.{ts,svelte}'],
	exclude: ['src/**/*.{test,spec}.ts', '.svelte-kit/**', 'build/**']
}
```

Add to `package.json` `scripts`:

```json
"test:coverage": "vitest run --coverage"
```

Add `coverage/` to `.gitignore` if absent (`grep -q "^coverage" .gitignore ||
echo "coverage/" >> .gitignore` — but make the edit in the file explicitly).

**Verify**: `npm run test:coverage` → runs the existing unit suite and prints a
coverage table (text reporter) + writes `coverage/` (html). Exit 0.

### Step 2: Write the first component test for MentionEditor

Create `src/lib/components/MentionEditor.svelte.test.ts`. Use
`@testing-library/svelte`'s `render` and `@testing-library/user-event` (already
transitively available via testing-library; if not installed, use fireEvent from
`@testing-library/svelte`). Structure:

```ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import MentionEditor from './MentionEditor.svelte';

describe('MentionEditor', () => {
	it('renders a contenteditable editor with the placeholder', () => {
		const { container } = render(MentionEditor, {
			props: { placeholder: 'Write something…', tasks: [{ id: 't1', title: 'Alpha' }] }
		});
		const editor = container.querySelector('[contenteditable="true"]');
		expect(editor).toBeInTheDocument();
	});

	it('emits a hidden input carrying the token value when `name` is set', async () => {
		const { container } = render(MentionEditor, {
			props: { name: 'description', value: 'hello @[Alpha](task:t1)' }
		});
		const hidden = container.querySelector('input[name="description"]');
		expect(hidden).toBeInTheDocument();
		expect(hidden).toHaveValue('hello @[Alpha](task:t1)');
	});
});
```

Then add DOM-interaction cases that exercise the `@`-picker (the layer the pure
unit tests can't reach). Cover at least:

- Typing `@` (dispatch an input event on the contenteditable, or use
  `user-event`) opens the picker — assert the search `<input>` (bound to
  `query`) becomes visible/in the document.
- With `tasks: [{ id, title }]` provided, the picker lists a matching candidate;
  selecting it (click / Enter) inserts a `@[...](task:id)` token into the hidden
  input's value.

Because `MentionEditor` drives the caret via the native Selection API and
contenteditable, jsdom has known gaps (see STOP conditions). Keep the first
committed test to what jsdom reliably supports (render, hidden-input
serialization, picker OPENING). If full selection-based insertion proves
infeasible in jsdom, land the render + picker-open assertions and RECORD the
insertion case as a deferred e2e/jsdom-limitation note rather than forcing it.

**Verify**: `npx vitest run src/lib/components/MentionEditor.svelte.test.ts` →
the committed cases pass; `npm run test:unit` → whole suite still green.

## Test plan

- New file: `src/lib/components/MentionEditor.svelte.test.ts`.
- Model the vitest describe/it style after an existing spec (e.g.
  `tests/unit/mentions.test.ts`) but with `@testing-library/svelte` `render`.
- Cases: (happy) renders contenteditable + placeholder; (serialization) hidden
  input reflects the token `value`; (interaction) typing `@` opens the picker;
  (interaction, if jsdom permits) selecting a task candidate inserts a token.
- Verification: `npm run test:coverage` produces a report AND at least one
  `*.svelte.test.ts` passes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test:coverage` runs and emits a coverage report (text + `coverage/`).
- [ ] `find src tests -name "*.svelte.test.ts"` returns at least
      `src/lib/components/MentionEditor.svelte.test.ts`.
- [ ] `npx vitest run src/lib/components/MentionEditor.svelte.test.ts` passes.
- [ ] `npm run test:unit` still passes (the new file is picked up by the existing
      `*.test.ts` include).
- [ ] `npm run check` exits 0.
- [ ] `MentionEditor.svelte` is unchanged (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- `render(MentionEditor)` throws because a required runes/plugin config is
  missing under vitest (e.g. `$props`/`$bindable` not transformed) — report the
  exact error; the SvelteKit vite plugin should handle Svelte 5, so an error
  here is a config issue to surface, not to hack around.
- The only way to make an interaction assertion pass is to edit
  `MentionEditor.svelte` — STOP; testing must be non-invasive.
- jsdom cannot simulate the contenteditable Selection/caret needed for token
  INSERTION — land the render + picker-open cases, record the insertion case as
  deferred (jsdom limitation → belongs in e2e), and continue. Do NOT delete the
  editor's Selection logic to make a test pass.
- `@vitest/coverage-v8` version conflicts with `vitest ^3` — install the version
  matching the installed vitest major; report if none resolves.

## Maintenance notes

- This establishes the pattern for `*.svelte.test.ts`; TaskPanel and the project
  page can follow once this harness is proven.
- Full contenteditable interaction (caret-anchored insertion) may stay in e2e
  where a real browser Selection exists — document which cases live where.
- A reviewer should confirm the component test asserts BEHAVIOR (rendered
  output, emitted value) not internal implementation, per the repo testing rules.
- Coverage numbers are a baseline, not a gate yet — do not add a coverage
  threshold that fails CI until the suite is broad enough (follow-up).
