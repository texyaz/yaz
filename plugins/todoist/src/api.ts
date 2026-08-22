/**
 * Todoist's API, as much of it as a paper's task list needs.
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
 * # Two APIs, because Todoist has two
 *
 * Todoist replaced the REST v2 API with a unified v1, and which one an account
 * answers on depends on when it was migrated. Guessing wrong looks exactly like
 * a bad token — a request fails and there is nothing to say why — so this tries
 * the newer one, falls back to the older, and remembers which answered.
 *
 * The two also disagree about shape: v1 wraps a list in `{results: [...]}` and
 * v2 returns the bare array. Both are read, because the difference is Todoist's
 * and not something a task list should have to care about.
 *
 * # Why the shapes are read defensively
 *
 * A field this does not recognise is ignored and a field that is missing is
 * absent rather than assumed. An API changing under a plugin is normal; a
 * plugin that empties the tab because a response gained a field is not.
 */

import type { App, Task, TaskProject } from "@yaz/api";

/** The unified API, which is where Todoist is going. */
const V1 = "https://api.todoist.com/api/v1";

/** The REST API, which many accounts still answer on. */
const V2 = "https://api.todoist.com/rest/v2";

/**
 * Which base answered, once something has.
 *
 * Remembered for the session so that every later call costs one request rather
 * than two. Reset by {@link forgetBase} when the credential changes, because a
 * different account may not be on the same one.
 */
let base: string | null = null;

/** Forget which API answered, so the next call probes again. */
export function forgetBase(): void {
  base = null;
}

/** What went wrong, in the service's own words where there are any. */
export class TodoistError extends Error {}

/** The message out of whatever the host threw. */
function reasonOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const detail = (error as Record<string, unknown>)["detail"];
    if (typeof detail === "string" && detail) return detail;
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

/**
 * Make a request, working out which API version answers.
 *
 * The first call tries both; every one after it uses whichever worked. A
 * failure from the *chosen* base is a real failure and is thrown with what the
 * service said, because "it did not work" is not something anybody can act on.
 */
async function request(
  app: App,
  path: string,
  options?: { method?: "GET" | "POST" | "DELETE"; body?: unknown },
): Promise<unknown> {
  if (base) {
    try {
      return await app.credentials.fetch(`${base}${path}`, options);
    } catch (error) {
      throw new TodoistError(reasonOf(error));
    }
  }

  let firstReason = "";
  for (const candidate of [V1, V2]) {
    try {
      const answer = await app.credentials.fetch(
        `${candidate}${path}`,
        options,
      );
      base = candidate;
      return answer;
    } catch (error) {
      // The first refusal is the one worth reporting: if the newer API says
      // "unauthorised" then the token is wrong, and the older one saying the
      // same adds nothing.
      if (!firstReason) firstReason = reasonOf(error);
    }
  }
  throw new TodoistError(firstReason || "Todoist could not be reached");
}

/**
 * The rows out of a list response.
 *
 * v1 wraps them in `{results: [...]}` and v2 returns the array itself.
 */
function rows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === "object" && body !== null) {
    const results = (body as Record<string, unknown>)["results"];
    if (Array.isArray(results)) return results;
  }
  return [];
}

/** Read a string field, treating an empty one as absent. */
function text(source: unknown, name: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[name];
  if (typeof value === "string" && value !== "") return value;
  // v1 numbers some ids that v2 spelled as strings.
  if (typeof value === "number") return String(value);
  return null;
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
  // v1 renamed `content` to `content` still, but a few shapes use `title`.
  const title = text(raw, "content") ?? text(raw, "title");
  if (!id || !title) return null;
  return {
    id,
    title,
    // Both APIs return open tasks; a completed one stops appearing.
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
  return rows(await request(app, "/projects"))
    .map(asProject)
    .filter((entry): entry is TaskProject => entry !== null);
}

/** Make a project, for a paper that has no list yet. */
export async function createProject(
  app: App,
  name: string,
): Promise<TaskProject> {
  const project = asProject(
    await request(app, "/projects", { method: "POST", body: { name } }),
  );
  if (!project) throw new TodoistError("Todoist did not return the new project");
  return project;
}

/**
 * The open tasks in a project.
 *
 * Only the open ones: completed tasks live behind a different endpoint, and a
 * list of what is done is not what somebody looking at a paper wants to see.
 */
export async function listTasks(app: App, projectId: string): Promise<Task[]> {
  const body = await request(
    app,
    `/tasks?project_id=${encodeURIComponent(projectId)}`,
  );
  return rows(body)
    .map(asTask)
    .filter((entry): entry is Task => entry !== null);
}

/** Add a task to a project. */
export async function createTask(
  app: App,
  projectId: string,
  title: string,
): Promise<Task> {
  const task = asTask(
    await request(app, "/tasks", {
      method: "POST",
      body: { content: title, project_id: projectId },
    }),
  );
  if (!task) throw new TodoistError("Todoist did not return the new task");
  return task;
}

/** Tick a task off. */
export async function completeTask(app: App, taskId: string): Promise<void> {
  await request(app, `/tasks/${encodeURIComponent(taskId)}/close`, {
    method: "POST",
  });
}

/**
 * Whether the stored token actually works, and why not when it does not.
 *
 * A cheap request rather than a guess: a token can be present and revoked, and
 * "signed in" that means "we have a string" is not worth showing anybody.
 *
 * The reason comes back with the answer because every way this can fail — a
 * mistyped token, a revoked one, a firewall, an API version that has been
 * turned off — used to look identical, and "it did not work" is not something
 * anybody can act on.
 */
export async function checkReach(
  app: App,
): Promise<{ ok: boolean; reason: string }> {
  if (!(await app.credentials.has())) {
    return { ok: false, reason: "" };
  }
  try {
    await request(app, "/projects");
    return { ok: true, reason: "" };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/** Whether the stored token works. See {@link checkReach} for why not. */
export async function canReach(app: App): Promise<boolean> {
  return (await checkReach(app)).ok;
}
