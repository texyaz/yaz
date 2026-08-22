/**
 * Keeping a paper's task list in Todoist.
 *
 * # What this is, and what it deliberately is not
 *
 * Writing a paper is three jobs and yaz is good at one of them. Zotero manages
 * the sources, Todoist manages what is left to do, and yaz manages the writing.
 * So this plugin is a *bridge*: it does not add a task list to yaz, it shows
 * one that lives somewhere else and lets it be added to without leaving the
 * document ([ADR-0026]).
 *
 * The tab, and what a task is, are core. This file answers about Todoist and
 * knows nothing about the tab — which is the property that makes a Things or a
 * Microsoft To Do plugin a new repository and no change to yaz.
 *
 * # Where the secrets and the link live
 *
 * The API token is in the operating system's keychain, reached through the
 * `credential` capability, and this plugin never sees it: it says which request
 * to make and yaz spends the token against `api.todoist.com`, the one host the
 * manifest declares.
 *
 * Which Todoist project a paper is linked to is stored *with the paper*, in
 * `yaz.toml`, because a thesis and a conference paper are different work with
 * different lists and the link should travel with the project.
 *
 * # Why there is no settings panel here
 *
 * Signing in and choosing the list both live under **Connections** in the
 * ribbon, beside Zotero. Connecting a paper to the things it is built from is
 * one kind of work and belongs in one place; Settings keeps what is per
 * install, and none of this is.
 *
 * [ADR-0026]: https://generalpawz.github.io/yaz/adr/0026-task-providers-and-credentials
 */

import { Plugin } from "@yaz/api";
import type { Task, TaskProject } from "@yaz/api";

import {
  canReach,
  completeTask,
  createProject,
  createTask,
  listProjects,
  listTasks,
} from "./api";

/** What this plugin stores against a project. */
interface ProjectLink {
  /** The Todoist project id. */
  id: string;
  /**
   * Its name at the time it was linked.
   *
   * Kept so the tab can say which list this is without a request — and so a
   * project renamed or deleted in Todoist still shows *something* rather than
   * an id nobody recognises.
   */
  name: string;
}

export default class TodoistPlugin extends Plugin {
  onload(): void {
    this.registerTaskProvider({
      id: "todoist",
      nameKey: "todoist-name",

      isReady: () => canReach(this.app),

      linkedProject: async () => {
        const stored = await this.app.settings.forProject.get<ProjectLink>();
        return stored?.id ? { id: stored.id, name: stored.name } : null;
      },

      link: async (project: TaskProject | null) => {
        await this.app.settings.forProject.set(
          project ? { id: project.id, name: project.name } : {},
        );
      },

      listProjects: () => listProjects(this.app),
      createProject: (name: string) => createProject(this.app, name),
      listTasks: (projectId: string) => listTasks(this.app, projectId),
      createTask: (projectId: string, title: string) =>
        createTask(this.app, projectId, title),
      completeTask: (taskId: string) => completeTask(this.app, taskId),
    });

    this.addCommand({
      id: "add-task",
      nameKey: "todoist-command-add",
      descriptionKey: "todoist-command-add-description",
      isAvailable: () => this.app.project !== null,
      callback: () => this.addFromSelection(),
    });
  }

  /**
   * Make a task out of what is selected, or ask for one.
   *
   * The selection because that is where a task usually comes from: you are
   * reading a paragraph, you notice it needs a citation, and the paragraph is
   * already under the cursor.
   */
  private async addFromSelection(): Promise<void> {
    const editor = this.app.editor;
    const selection = editor?.getSelection();
    const selected =
      editor && selection && selection.to > selection.from
        ? editor.getText().slice(selection.from, selection.to)
        : "";

    const title = selected.replace(/\s+/g, " ").trim().slice(0, TITLE_LIMIT);
    if (!title) {
      this.app.notices.show("todoist-notice-nothing-selected");
      return;
    }

    const stored = await this.app.settings.forProject.get<ProjectLink>();
    if (!stored?.id) {
      this.app.notices.show("todoist-notice-not-linked");
      return;
    }

    try {
      await createTask(this.app, stored.id, title);
      // The tab is core and does not know a task was added, so it is told.
      this.app.tasks.refresh();
      this.app.notices.show("todoist-notice-added");
    } catch {
      this.app.notices.show("todoist-notice-failed");
    }
  }
}

/**
 * How long a task made from a selection may be.
 *
 * A whole paragraph is not a task. Truncating is better than refusing: the
 * author can see what they made and fix it in Todoist.
 */
const TITLE_LIMIT = 200;


/** Re-exported so the tests can reach it without a running yaz. */
export type { ProjectLink, Task };
