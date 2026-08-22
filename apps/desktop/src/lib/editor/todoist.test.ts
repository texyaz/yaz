/**
 * Reading what Todoist returns.
 *
 * The mapping is the part that can be wrong without anybody noticing: a field
 * renamed upstream turns into a task with no title, and a list of blanks looks
 * like an empty project rather than a bug.
 *
 * Tested from the application's suite because the plugin repos have no runner
 * of their own yet. The network is not touched — `credentials.fetch` is the
 * seam, and it is what these stand in for.
 */

import { describe, expect, it } from "vitest";

import {
  canReach,
  completeTask,
  createProject,
  createTask,
  listProjects,
  checkReach,
  forgetBase,
  listTasks,
} from "../../../../../plugins/todoist/src/api";

/** An `App` with only what the API client actually reaches for. */
interface Recorded {
  url?: string | undefined;
  method?: string | undefined;
  body?: unknown;
}

function appReturning(answer: unknown, record: Recorded = {}) {
  // Each of these stands alone, so which API version a previous one settled on
  // must not decide what this one exercises.
  forgetBase();
  return {
    credentials: {
      has: () => Promise.resolve(true),
      set: () => Promise.resolve(),
      forget: () => Promise.resolve(),
      fetch: (url: string, options?: { method?: string; body?: unknown }) => {
        record.url = url;
        record.method = options?.method;
        record.body = options?.body;
        return Promise.resolve(answer);
      },
    },
  } as never;
}

describe("reading Todoist's projects", () => {
  it("keeps the ones that have an id and a name", () => {
    const app = appReturning([
      { id: "220", name: "Thesis" },
      { id: "221", name: "Conference paper" },
    ]);
    return expect(listProjects(app)).resolves.toEqual([
      { id: "220", name: "Thesis" },
      { id: "221", name: "Conference paper" },
    ]);
  });

  it("drops one that is missing either", () => {
    // A row with no name cannot be shown or chosen, and offering a blank line
    // is worse than offering nothing.
    const app = appReturning([{ id: "220" }, { name: "Nameless" }]);
    return expect(listProjects(app)).resolves.toEqual([]);
  });

  it("survives a response that is not a list at all", () => {
    return expect(
      listProjects(appReturning({ error: "nope" })),
    ).resolves.toEqual([]);
  });
});

describe("reading Todoist's tasks", () => {
  it("reads the title, the due date and the priority", () => {
    const app = appReturning([
      {
        id: "77",
        content: "Chase the DIN 277 page number",
        due: { date: "2026-09-01", string: "1 Sep" },
        priority: 3,
        url: "https://app.todoist.com/app/task/77",
      },
    ]);
    return expect(listTasks(app, "220")).resolves.toEqual([
      {
        id: "77",
        title: "Chase the DIN 277 page number",
        done: false,
        due: "2026-09-01",
        priority: 3,
        url: "https://app.todoist.com/app/task/77",
      },
    ]);
  });

  it("falls back to the words when there is no plain date", () => {
    // A recurring task has no single date, and "every Monday" is more use than
    // nothing.
    const app = appReturning([
      { id: "78", content: "Weekly read", due: { string: "every Monday" } },
    ]);
    return expect(
      listTasks(app, "220").then((tasks) => tasks[0]?.due),
    ).resolves.toBe("every Monday");
  });

  it("says nothing rather than guessing when a task has no date", () => {
    const app = appReturning([{ id: "79", content: "Someday" }]);
    return expect(
      listTasks(app, "220").then((tasks) => tasks[0]?.due),
    ).resolves.toBeNull();
  });

  it("asks for one project's tasks, not the whole account's", () => {
    const record: Recorded = {};
    const app = appReturning([], record);
    return listTasks(app, "2 20").then(() => {
      expect(record.url).toContain("project_id=2%2020");
    });
  });
});

describe("writing to Todoist", () => {
  it("posts a new task with its project", () => {
    const record: Recorded = {};
    const app = appReturning({ id: "80", content: "Redraw figure 3" }, record);
    return createTask(app, "220", "Redraw figure 3").then((task) => {
      expect(record.method).toBe("POST");
      expect(record.body).toEqual({
        content: "Redraw figure 3",
        project_id: "220",
      });
      expect(task.title).toBe("Redraw figure 3");
    });
  });

  it("refuses a response it cannot read rather than inventing a task", () => {
    // A task with no id cannot be completed later, so pretending it was made
    // would leave a row nobody can tick off.
    return expect(
      createTask(appReturning({ nonsense: true }), "220", "x"),
    ).rejects.toThrow();
  });

  it("posts a project by name", () => {
    const record: Recorded = {};
    const app = appReturning({ id: "222", name: "BimWissT" }, record);
    return createProject(app, "BimWissT").then((project) => {
      expect(record.body).toEqual({ name: "BimWissT" });
      expect(project).toEqual({ id: "222", name: "BimWissT" });
    });
  });

  it("closes a task rather than deleting it", () => {
    // Completing and deleting are different things, and a plugin that deleted
    // somebody's task because they ticked it would be unforgivable.
    const record: Recorded = {};
    const app = appReturning(null, record);
    return completeTask(app, "77").then(() => {
      expect(record.url).toContain("/tasks/77/close");
      expect(record.method).toBe("POST");
    });
  });
});

describe("which API version answers", () => {
  it("uses the unified API when it answers", () => {
    const record: Recorded = {};
    forgetBase();
    const app = appReturning(
      { results: [{ id: "1", name: "Thesis" }] },
      record,
    );
    return listProjects(app).then((projects) => {
      expect(record.url).toContain("/api/v1/projects");
      // And reads the wrapped shape it returns.
      expect(projects).toEqual([{ id: "1", name: "Thesis" }]);
    });
  });

  it("reads the bare list the older API returns", () => {
    forgetBase();
    const app = appReturning([{ id: "1", name: "Thesis" }]);
    return expect(listProjects(app)).resolves.toEqual([
      { id: "1", name: "Thesis" },
    ]);
  });

  it("says what went wrong rather than that something did", () => {
    // Every way this fails used to look identical, which sent somebody to
    // make a new token that failed the same way.
    forgetBase();
    const app = {
      credentials: {
        has: () => Promise.resolve(true),
        fetch: () => Promise.reject({ detail: "401: Forbidden" }),
      },
    } as never;
    return checkReach(app).then((outcome) => {
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toContain("401");
    });
  });

  it("has no reason to give when nothing is stored", () => {
    const app = {
      credentials: {
        has: () => Promise.resolve(false),
        fetch: () => Promise.reject(new Error("should not be called")),
      },
    } as never;
    return expect(checkReach(app)).resolves.toEqual({ ok: false, reason: "" });
  });
});

describe("whether the token works", () => {
  it("is not ready when nothing is stored", () => {
    const app = {
      credentials: {
        has: () => Promise.resolve(false),
        fetch: () => Promise.reject(new Error("should not be called")),
      },
    } as never;
    return expect(canReach(app)).resolves.toBe(false);
  });

  it("is not ready when the stored token is refused", () => {
    // A token can be present and revoked. "Signed in" that only means "we have
    // a string" is not worth showing anybody.
    const app = {
      credentials: {
        has: () => Promise.resolve(true),
        fetch: () => Promise.reject(new Error("401")),
      },
    } as never;
    return expect(canReach(app)).resolves.toBe(false);
  });

  it("is ready when the service answers", () => {
    return expect(canReach(appReturning([]))).resolves.toBe(true);
  });
});
