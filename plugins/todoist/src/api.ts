/**
 * Todoist's REST API, as much of it as a paper's task list needs.
 *
 * # The token never comes near this file
 *
 * Every request goes through `app.credentials.fetch`, which adds the
 * authorisation in the Rust process. This plugin says *which* request to make
 * and never sees the token — so it can spend the credential against
 * `api.todoist.com`, which its manifest declares, and cannot read it, copy it,
 * or send it anywhere else
 * ([ADR-0026](https://generalpawz.github.io/yaz/adr/0026-task-providers-and-credentials)).
 *
 * That is why there is no `Authorization` header anywhere below, and why there
 * must never be one.
 *
 * # Why the shapes are read defensively
 *
 * A field this does not recognise is ignored and a field that is missing is
 * absent rather than assumed. An API changing under a plugin is normal; a
 * plugin that crashes the tab because a response gained a field is not.
 */

import type { App, Task, TaskProject } from "@yaz/api";

/** Todoist's REST base. A constant, not a setting: see the module note. */
const API = "https://api.todoist.com/rest/v2";

/** Read a string field, treating an empty one as absent. */
function text(source: unknown, name: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[name];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read a number field. */
function number(source: unknown, name: string): number | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[name];
  return typeof value === "number" ? value : null;
}

/**
 * The date a task is due, as Todoist gives it.
 *
 * Its `due` is an object with several spellings of the same day — `date`,
 * `datetime`, and a `string` in the user's own words ("every Monday"). The
 * plain date is what a list wants; the rest is Todoist's business.
 */
function dueOf(task: unknown): string | null {
  if (typeof task !== "object" || task === null) return null;
  const due = (task as Record<string, unknown>)["due"];
  return text(due, "date") ?? text(due, "string");
}

/** One Todoist task, as the core tab needs it. */
function asTask(raw: unknown): Task | null {
  const id = text(raw, "id");
  const title = text(raw, "content");
  if (!id || !title) return null;
  return {
    id,
    title,
    // The REST API returns open tasks; a completed one simply stops appearing.
    done: false,
    due: dueOf(raw),
    priority: number(raw, "priority"),
    url: text(raw, "url"),
  };
}

/** One Todoist project, as a list a paper can be linked to. */
function asProject(raw: unknown): TaskProject | null {
  const id = text(raw, "id");
  const name = text(raw, "name");
  return id && name ? { id, name } : null;
}

/** Every project the account can see. */
export async function listProjects(app: App): Promise<TaskProject[]> {
  const body = await app.credentials.fetch(`${API}/projects`);
  return Array.isArray(body)
    ? body.map(asProject).filter((entry): entry is TaskProject => entry !== null)
    : [];
}

/** Make a project, for a paper that has no list yet. */
export async function createProject(
  app: App,
  name: string,
): Promise<TaskProject> {
  const body = await app.credentials.fetch(`${API}/projects`, {
    method: "POST",
    body: { name },
  });
  const project = asProject(body);
  if (!project) throw new Error("Todoist did not return the new project");
  return project;
}

/**
 * The open tasks in a project.
 *
 * Only the open ones: Todoist's completed tasks live behind a different
 * endpoint, and a list of what is done is not what somebody looking at a paper
 * wants to see.
 */
export async function listTasks(
  app: App,
  projectId: string,
): Promise<Task[]> {
  const body = await app.credentials.fetch(
    `${API}/tasks?project_id=${encodeURIComponent(projectId)}`,
  );
  return Array.isArray(body)
    ? body.map(asTask).filter((entry): entry is Task => entry !== null)
    : [];
}

/** Add a task to a project. */
export async function createTask(
  app: App,
  projectId: string,
  title: string,
): Promise<Task> {
  const body = await app.credentials.fetch(`${API}/tasks`, {
    method: "POST",
    body: { content: title, project_id: projectId },
  });
  const task = asTask(body);
  if (!task) throw new Error("Todoist did not return the new task");
  return task;
}

/** Tick a task off. */
export async function completeTask(app: App, taskId: string): Promise<void> {
  await app.credentials.fetch(
    `${API}/tasks/${encodeURIComponent(taskId)}/close`,
    { method: "POST" },
  );
}

/**
 * Whether the stored token actually works.
 *
 * A cheap request rather than a guess: a token can be present and revoked, and
 * "signed in" that means "we have a string" is not worth showing anybody.
 */
export async function canReach(app: App): Promise<boolean> {
  if (!(await app.credentials.has())) return false;
  try {
    await app.credentials.fetch(`${API}/projects`);
    return true;
  } catch {
    return false;
  }
}
