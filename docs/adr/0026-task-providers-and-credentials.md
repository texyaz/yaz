# 0026 — A task list is a core tab; a credential is a capability

- **Status:** Accepted
- **Date:** 2026-08-22
- **Supersedes:** —
- **Superseded by:** —

## Context

Writing a paper is three jobs and yaz is only good at one of them. Zotero
manages the sources, a to-do application manages what is left to do, and yaz
manages the writing. The Zotero bridge already draws that line
([ADR-0008](0008-zotero-integration.md)): yaz does not become a reference
manager, it reads one.

The same line is now wanted for tasks — "redraw figure 3", "chase the DIN 277
citation", "send chapter 4 to Melzner" — and the same two questions come with
it.

**Which side of the plugin boundary does a task list live on?** Todoist is one
of a dozen; Things, Microsoft To Do, an Obsidian task list and a plain
`TODO.md` are all plausible, and every one of them is somebody's preference
rather than a fact about writing.

**Where does an API token live?** Talking to Todoist means holding a credential
that reads and writes somebody's entire task list, across every project they
have — most of which have nothing to do with yaz. This is the first secret the
application holds, and
[the Zotero roadmap](../../plugins/zotero/ROADMAP.md) already named it as a
design question deferred rather than solved.

## Decision

### The tab is core; the tasks come from a plugin

Exactly the shape [ADR-0025](0025-generated-lists-are-tabs.md) settled on for
citations. **What a task is** — a title, whether it is done, when it is due —
is core, and so is the tab that shows one. **Where tasks come from** is a
plugin.

```ts
app.tasks.registerProvider({
  id: "todoist",
  nameKey: "todoist-provider-name",
  listProjects(): Promise<TaskProject[]>;
  createProject(name: string): Promise<TaskProject>;
  listTasks(projectId: string): Promise<Task[]>;
  createTask(projectId: string, title: string): Promise<Task>;
  completeTask(taskId: string): Promise<void>;
});
```

A provider answers about _its_ service and knows nothing about the tab. The tab
knows nothing about Todoist. Adding Things later is a new plugin and no change
here — which is the test this design has to pass, and the reason not to build
the tab around whatever Todoist happens to return.

**Which project a paper is linked to is per project, not per install.** A thesis
and a conference paper are different work with different task lists, so the link
goes in `yaz.toml` beside the engine and the pane layout — and travels with the
project rather than with the machine.

### A credential is a capability, stored by the operating system

Three things follow from the security boundary being the Rust process
([ADR-0006](0006-plugin-runtime-and-capabilities.md)).

**It is declared.** `{"kind": "credential"}` in the manifest, so installing a
plugin that wants one says so, the same way `net` says which hosts it will
reach. A plugin that has not declared it is refused before any work happens.

**It is namespaced, and the namespace is not the caller's to choose.** A plugin
reads and writes under the id the runtime instantiated it as. There is no
parameter for "whose secret", so there is no way to ask for another plugin's —
the same rule `app.settings` follows.

**It is stored by the operating system, not by us.** Windows Credential
Manager, macOS Keychain, the Secret Service on Linux — through the `keyring`
crate, which has a native implementation on each and needs no C toolchain on
`aarch64-pc-windows-msvc` ([ADR-0014](0014-target-platforms-and-arm64.md)).

A token in `settings.json` would be a token in every backup, every sync folder
and every screen-share of a config directory. The keychain is what the platform
provides for exactly this, and using it means a stolen laptop with an encrypted
disk does not also hand over somebody's task list.

**The token never reaches the webview.** The plugin asks the Rust side to make
the request; it does not ask for the secret and add a header itself. So a plugin
holding a Todoist credential cannot read the token, only spend it — and only
against the hosts its manifest declared.

## Consequences

- **A to-do integration is a plugin repository**, released on its own like the
  others ([ADR-0021](0021-plugin-distribution.md)). `yaz-todoist` is the first.
- **The Tasks tab is empty and says so** when nothing is linked. That is the
  honest state for a project whose author does not use a to-do application, and
  it is most projects.
- **`keyring` is a new dependency.** It is small, has no C dependencies on
  Windows, and the alternative is writing three platform bindings.
- **A machine with no keychain cannot store a token.** Some Linux desktops have
  no Secret Service running. That is reported rather than silently falling back
  to a file — a fallback that quietly weakened the storage would be worse than
  saying it did not work.
- **Revoking is Todoist's job.** yaz can forget a token; it cannot invalidate
  one. The settings panel links to where a token is revoked, because telling
  somebody their secret is gone from _this_ machine is not the same as telling
  them it is safe.
