# Task

Webwright evidence script for the Baskets app core flow: sign in as the seeded
admin, create a project, create a task in it, open the task side pane and edit
its title + description, then verify the edit persisted. Headless Firefox,
screenshot every critical point, self-verify. Cleans up the project it creates.

# Parameters

| name         | type | source phrase from task        | default                                  | allowed / format            |
|--------------|------|--------------------------------|------------------------------------------|-----------------------------|
| base_url     | str  | "running at localhost:5173"    | "http://localhost:5173"                  | http(s) origin, no trailing /|
| email        | str  | "seeded admin"                 | "admin@baskets.local"                    | login email                 |
| password     | str  | "seeded admin"                 | "admin-baskets-2026"                     | login password              |
| project_name | str  | "create a new project"         | "Webwright demo project"                 | ≤120 chars                  |
| task_title   | str  | "create a task"                | "Webwright demo task"                    | ≤240 chars                  |
| task_desc    | str  | "edit its title/description"   | "Created by the webwright evidence run." | free text                   |
| cleanup      | bool | (idempotency, not in task)     | True                                     | --no-cleanup to keep data   |

# Critical Points

- [x] CP1: Sign in as the seeded admin via the /login email+password form and reach the authenticated app shell (redirect to /projects). Evidence: final_execution_1_signed_in_app_shell.png (admin top-right, sidebar, + New project).
- [x] CP2: Create a new project (project_name) via /projects → "+ New project"; land on /projects/<id> with the project heading visible. Evidence: final_execution_2_project_created.png + log step 2 (project_url).
- [x] CP3: Open the project "…" menu → Create… → Task, fill the New-task pane, Create; the task appears as a button.task-title in the Table view. Evidence: final_execution_3_task_created.png.
- [x] CP4: Click the task title to open the "Task details" side pane; edit Title (→ "<task_title> (edited)") and Description (→ task_desc), each auto-saving on blur; edited title propagates to the table row. Evidence: final_execution_4_task_edited.png.
- [x] CP5: Reload the project page, re-open the task pane, and confirm the edited Title + Description persisted. Evidence: final_execution_5_persisted_after_reload.png (pane Title=edited, Desc set, activity log shows created+renamed); log step 5 persisted=True.

Final datum = the persisted edited task title.
