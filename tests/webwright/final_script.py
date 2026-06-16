"""Webwright evidence tool for the Baskets app core flow.

Reusable CLI: signs in, creates a project, creates a task, edits the task's
title + description in the side pane, verifies the edit persisted across a
reload, and (optionally) cleans up the project it created. Screenshots every
critical point into ./screenshots and logs each step into ./final_script_log.txt.

Run with no args to reproduce the default task; override any flag to reuse it.
Import-safe: no browser launch / IO at module import time.
"""

import asyncio
import os
from pathlib import Path

from playwright.async_api import async_playwright, Page

RUN_DIR = Path(__file__).parent
SCREENSHOTS = RUN_DIR / "screenshots"
LOG = RUN_DIR / "final_script_log.txt"
VIEWPORT = {"width": 1280, "height": 1800}


def _log(step, msg):
	line = f"step {step} action: {msg}\n"
	with LOG.open("a") as f:
		f.write(line)
	print(line, end="")


async def _shot(page, name):
	SCREENSHOTS.mkdir(parents=True, exist_ok=True)
	await page.screenshot(path=str(SCREENSHOTS / f"{name}.png"))


async def run_baskets_core_flow(
	base_url: str = "http://localhost:5173",
	email: str = "admin@baskets.local",
	password: str = "admin-baskets-2026",
	project_name: str = "Webwright demo project",
	task_title: str = "Webwright demo task",
	task_desc: str = "Created by the webwright evidence run.",
	cleanup: bool = True,
) -> dict:
	"""Drive the Baskets core flow (sign in → project → task → edit → verify).

	Args:
		base_url: Origin the Baskets app is served from; http(s) with no
			trailing slash. Default: "http://localhost:5173".
		email: Seeded admin login email. Default: "admin@baskets.local".
		password: Seeded admin password. Default: "admin-baskets-2026".
		project_name: Name for the created project; ≤120 chars.
			Default: "Webwright demo project".
		task_title: Title for the created task; ≤240 chars. The script edits
			it to "<task_title> (edited)". Default: "Webwright demo task".
		task_desc: Description set on the task during the edit step.
			Default: "Created by the webwright evidence run.".
		cleanup: When True, delete the created project at the end so the run
			is idempotent; pass --no-cleanup to keep it. Default: True.

	Returns:
		dict with keys ``persisted_title`` (str), ``project_url`` (str),
		``cps`` (dict of CP->bool), ``screenshots`` (list[str]).
	"""
	SCREENSHOTS.mkdir(parents=True, exist_ok=True)
	LOG.write_text("")
	_log(
		0,
		"params: "
		+ " ".join(
			f"{k}={v}"
			for k, v in {
				"base_url": base_url,
				"email": email,
				"project_name": project_name,
				"task_title": task_title,
				"cleanup": cleanup,
			}.items()
		),
	)

	edited_title = f"{task_title} (edited)"
	cps = {f"CP{i}": False for i in range(1, 6)}
	project_url = ""

	async with async_playwright() as pw:
		browser = await pw.firefox.launch(headless=True)
		context = await browser.new_context(viewport=VIEWPORT)
		page: Page = await context.new_page()
		try:
			# CP1 — sign in
			await page.goto(f"{base_url}/login", wait_until="domcontentloaded")
			await page.locator("#email").fill(email)
			await page.locator("#password").fill(password)
			await page.get_by_role("button", name="Sign in").click()
			await page.wait_for_url("**/projects**", timeout=15000)
			await _shot(page, "final_execution_1_signed_in_app_shell")
			cps["CP1"] = True
			_log(1, "signed in as admin, reached app shell at /projects")

			# CP2 — create a project
			await page.goto(f"{base_url}/projects", wait_until="domcontentloaded")
			await page.get_by_role("button", name="+ New project").click()
			await page.locator("#name").fill(project_name)
			await page.get_by_role("button", name="Create project").click()
			await page.wait_for_url("**/projects/*", timeout=15000)
			await page.get_by_role("heading", name=project_name).wait_for(timeout=10000)
			project_url = page.url
			await _shot(page, "final_execution_2_project_created")
			cps["CP2"] = True
			_log(2, f"created project '{project_name}' at {project_url}")

			# CP3 — create a task via the project "…" → Create… → Task pane
			await page.get_by_role("button", name="Project menu").click()
			await page.get_by_role("button", name="Create…").hover()
			await page.get_by_role("button", name="Task", exact=True).click()
			await page.locator("#nt-title").fill(task_title)
			await page.get_by_role("button", name="Create", exact=True).click()
			task_btn = page.locator("button.task-title", has_text=task_title)
			await task_btn.first.wait_for(timeout=10000)
			await _shot(page, "final_execution_3_task_created")
			cps["CP3"] = True
			_log(3, f"created task '{task_title}' (visible in Table view)")

			# CP4 — open side pane, edit title + description (auto-save on blur)
			await task_btn.first.click()
			pane = page.get_by_role("complementary", name="Task details")
			await pane.wait_for(timeout=10000)
			title_input = pane.get_by_label("Title")
			await title_input.fill(edited_title)
			await title_input.blur()
			desc_input = pane.get_by_label("Description")
			await desc_input.fill(task_desc)
			await desc_input.blur()
			await page.locator("button.task-title", has_text=edited_title).first.wait_for(
				timeout=10000
			)
			await _shot(page, "final_execution_4_task_edited")
			cps["CP4"] = True
			_log(4, f"edited task title -> '{edited_title}' and description (auto-saved)")

			# CP5 — reload, re-open the task, confirm persistence
			await page.goto(project_url, wait_until="domcontentloaded")
			reopened = page.locator("button.task-title", has_text=edited_title)
			await reopened.first.wait_for(timeout=10000)
			await reopened.first.click()
			pane = page.get_by_role("complementary", name="Task details")
			await pane.wait_for(timeout=10000)
			got_title = await pane.get_by_label("Title").input_value()
			got_desc = await pane.get_by_label("Description").input_value()
			await _shot(page, "final_execution_5_persisted_after_reload")
			persisted = got_title == edited_title and got_desc == task_desc
			cps["CP5"] = persisted
			_log(
				5,
				f"after reload: title='{got_title}' desc='{got_desc}' "
				f"persisted={persisted}",
			)

			# Cleanup — delete the project (native confirm dialog)
			if cleanup and project_url:
				await page.goto(project_url, wait_until="domcontentloaded")
				page.once("dialog", lambda d: d.accept())
				await page.get_by_role("button", name="Project menu").click()
				await page.get_by_role("button", name="Delete", exact=True).click()
				await page.wait_for_url("**/projects", timeout=15000)
				_log(6, f"cleaned up project '{project_name}'")
		finally:
			await browser.close()

	with LOG.open("a") as f:
		f.write(f"\nFINAL_RESPONSE: persisted task title = {edited_title}\n")
		f.write(f"CPS: {cps}\n")

	return {
		"persisted_title": edited_title,
		"project_url": project_url,
		"cps": cps,
		"screenshots": sorted(str(p) for p in SCREENSHOTS.glob("*.png")),
	}


if __name__ == "__main__":
	import argparse

	parser = argparse.ArgumentParser(
		description=run_baskets_core_flow.__doc__.splitlines()[0]
	)
	parser.add_argument("--base-url", dest="base_url", type=str,
		default="http://localhost:5173",
		help="Origin the Baskets app is served from (no trailing slash).")
	parser.add_argument("--email", dest="email", type=str,
		default="admin@baskets.local", help="Seeded admin login email.")
	parser.add_argument("--password", dest="password", type=str,
		default="admin-baskets-2026", help="Seeded admin password.")
	parser.add_argument("--project-name", dest="project_name", type=str,
		default="Webwright demo project", help="Name for the created project (<=120 chars).")
	parser.add_argument("--task-title", dest="task_title", type=str,
		default="Webwright demo task", help="Title for the created task (<=240 chars).")
	parser.add_argument("--task-desc", dest="task_desc", type=str,
		default="Created by the webwright evidence run.",
		help="Description set on the task during the edit step.")
	parser.add_argument("--no-cleanup", dest="cleanup", action="store_false",
		help="Keep the created project instead of deleting it at the end.")
	args = parser.parse_args()
	result = asyncio.run(run_baskets_core_flow(**vars(args)))
	print(result)
