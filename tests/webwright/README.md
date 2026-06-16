# Webwright evidence scripts

Screenshot-evidence browser walkthroughs of the Baskets core flow, **supplementing**
the `@playwright/test` regression suite in `tests/e2e/`. Where the e2e specs are
fast pass/fail assertions for CI, these produce visual proof: a self-verifying
Python + headless-Firefox script that screenshots every critical point.

This is the [Webwright](https://github.com/microsoft) code-as-action pattern:
`plan.md` lists critical points (CP1…CPn); `final_script.py` drives the browser,
logs each step, and saves one screenshot per CP into `final_runs/run_<id>/`.

## Setup (one-time, Python — separate from the npm toolchain)

```bash
python3 -m pip install --user playwright
python3 -m playwright install firefox
```

## Run (needs the dev server on :5173, seeded admin)

```bash
# default flow
python3 tests/webwright/final_script.py

# parameterized — reusable CLI
python3 tests/webwright/final_script.py \
  --project-name "My project" --task-title "My task" --no-cleanup
python3 tests/webwright/final_script.py --help
```

Each clean run writes to `final_runs/run_<id>/` (`final_script.py`,
`screenshots/final_execution_<step>_<action>.png`, `final_script_log.txt`).
The script is import-safe (no browser launch at import) and idempotent
(deletes the project it creates unless `--no-cleanup`).

## Critical points covered (`plan.md`)

CP1 sign in → CP2 create project → CP3 create task → CP4 edit title+description
in the side pane → CP5 verify persistence across a reload.

## Not committed

`final_runs/` (screenshots + logs) is gitignored — it's regenerated per run.
Run the script to produce fresh evidence.
