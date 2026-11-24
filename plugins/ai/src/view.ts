/**
 * The AI writing tab: every AI sentence in the paper, the passage it rests
 * on, and the author's two decisions — proof it or throw it out (ADR-0032).
 *
 * Built from plain DOM, because a view gets an `HTMLElement` and nothing else
 * (ADR-0005). Re-read from the buffer when the document changes, debounced:
 * the tab is never on the keystroke path (ADR-0015).
 */

import type { ViewHandle, ZoteroHighlight } from "@yaz/api";

import type { Entry } from "./journal";
import { lineOf, wordDiff, type Mark } from "./marks";
import type { Status, Writing } from "./writing";

type Filter = "todo" | "edited" | "proofed" | "all";

/** Wait this long after the last change before reading the document again. */
const SETTLE_MS = 400;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountWritingView(
  writing: Writing,
  container: HTMLElement,
): ViewHandle {
  const { app } = writing;
  const t = (key: string, params?: Record<string, string | number>) =>
    app.i18n.t(key, params);

  let filter: Filter = "todo";
  /** The selected mark, by its start offset when last read. */
  let selected: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Highlights already fetched, by key; `null` means "not in the library". */
  const highlights = new Map<string, ZoteroHighlight | null>();
  let destroyed = false;

  const root = el("div", "yaz-ai");
  container.append(root);

  async function highlightOf(key: string): Promise<ZoteroHighlight | null> {
    if (!highlights.has(key)) {
      try {
        highlights.set(key, await app.zotero.highlight(key));
      } catch {
        return null;
      }
    }
    return highlights.get(key) ?? null;
  }

  function button(
    labelKey: string,
    onclick: () => void | Promise<void>,
    className = "yaz-ai-button",
  ): HTMLButtonElement {
    const node = el("button", className, t(labelKey));
    node.type = "button";
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      void onclick();
    });
    return node;
  }

  function shown(status: Status): boolean {
    switch (filter) {
      case "todo":
        return status !== "proofed";
      case "edited":
        return status === "edited";
      case "proofed":
        return status === "proofed";
      default:
        return true;
    }
  }

  async function renderGuide(into: HTMLElement): Promise<void> {
    const settings = await writing.settings();
    const box = el("details", "yaz-ai-guide");
    if (settings.proposedGuide) box.open = true;
    box.append(el("summary", "", t("ai-guide-title")));

    if (settings.proposedGuide) {
      const proposal = el("div", "yaz-ai-proposal");
      proposal.append(el("p", "yaz-ai-note", t("ai-guide-proposed")));
      proposal.append(el("pre", "yaz-ai-guide-text", settings.proposedGuide.text));
      const actions = el("div", "yaz-ai-actions");
      actions.append(
        button(
          "ai-guide-accept",
          () =>
            writing.updateSettings({
              styleGuide: settings.proposedGuide?.text ?? "",
              proposedGuide: null,
            }),
          "yaz-ai-button yaz-ai-primary",
        ),
        button("ai-guide-dismiss", () =>
          writing.updateSettings({ proposedGuide: null }),
        ),
      );
      proposal.append(actions);
      box.append(proposal);
    }

    box.append(el("p", "yaz-ai-note", t("ai-guide-explain")));
    const area = el("textarea", "yaz-ai-guide-edit");
    area.value = settings.styleGuide;
    area.placeholder = t("ai-guide-placeholder");
    area.rows = 6;
    area.addEventListener("change", () => {
      void writing.updateSettings({ styleGuide: area.value });
    });
    box.append(area);

    const commit = el("label", "yaz-ai-check");
    const toggle = el("input");
    toggle.type = "checkbox";
    toggle.checked = settings.commitOnProof;
    toggle.addEventListener("change", () => {
      void writing.updateSettings({ commitOnProof: toggle.checked });
    });
    commit.append(toggle, el("span", "", t("ai-setting-commit")));
    box.append(commit);

    const lessons = await writing.lessons(1000);
    box.append(
      el(
        "p",
        "yaz-ai-note",
        t("ai-guide-learned", {
          decided: lessons.decided,
          rewritten: lessons.rewritten.length,
          rejected: lessons.rejected.length,
        }),
      ),
    );
    into.append(box);
  }

  function renderDiff(original: string, body: string): HTMLElement {
    const diff = el("p", "yaz-ai-diff");
    for (const part of wordDiff(original, body)) {
      const span = el(
        part.kind === "same" ? "span" : part.kind === "removed" ? "del" : "ins",
        "",
        `${part.text} `,
      );
      diff.append(span);
    }
    return diff;
  }

  async function renderDetail(
    mark: Mark,
    status: Status,
    into: HTMLElement,
  ): Promise<void> {
    const detail = el("div", "yaz-ai-detail");
    const original = await writing.original(mark);
    if (status === "edited" && original) {
      detail.append(el("p", "yaz-ai-label", t("ai-detail-your-edit")));
      detail.append(renderDiff(original, mark.body));
    }
    for (const key of mark.keys) {
      const found = await highlightOf(key);
      const passage = el("div", "yaz-ai-passage");
      if (!found) {
        passage.append(
          el("p", "yaz-ai-note", t("ai-detail-highlight-missing", { key })),
        );
      } else {
        passage.append(
          el(
            "p",
            "yaz-ai-label",
            t("ai-detail-highlight", {
              source: found.citationKey ?? key,
              page: found.page ?? "?",
            }),
          ),
        );
        if (found.text) passage.append(el("blockquote", "", found.text));
        if (found.comment) {
          passage.append(
            el("p", "yaz-ai-comment", t("ai-detail-comment", { comment: found.comment })),
          );
        }
      }
      detail.append(passage);
    }
    const actions = el("div", "yaz-ai-actions");
    actions.append(button("ai-action-show", () => writing.showHighlight(mark)));
    if (mark.kind === "ai") {
      actions.append(
        button("ai-action-proof", () => writing.proof(mark), "yaz-ai-button yaz-ai-primary"),
        button("ai-action-reject", () => writing.reject(mark), "yaz-ai-button yaz-ai-danger"),
      );
    }
    detail.append(actions);
    into.append(detail);
  }

  async function render(): Promise<void> {
    if (destroyed) return;
    const editor = app.editor;
    const fresh = el("div", "yaz-ai-inner");
    if (!editor) {
      fresh.append(el("p", "yaz-ai-empty", t("ai-no-document")));
      root.replaceChildren(fresh);
      return;
    }
    const text = editor.getText();
    const entries: Entry[] = await writing.entries();
    const all = writing.marks().map((mark) => ({
      mark,
      status: writing.statusOf(mark, entries),
    }));
    const proofed = all.filter((item) => item.status === "proofed").length;

    const head = el("div", "yaz-ai-head");
    head.append(
      el(
        "span",
        "yaz-ai-progress",
        t("ai-progress", { proofed, total: all.length }),
      ),
    );
    const choose = el("select", "yaz-ai-filter");
    for (const option of ["todo", "edited", "proofed", "all"] as Filter[]) {
      const node = el("option", "", t(`ai-filter-${option}`));
      node.value = option;
      node.selected = option === filter;
      choose.append(node);
    }
    choose.addEventListener("change", () => {
      filter = choose.value as Filter;
      void render();
    });
    head.append(
      choose,
      button("ai-action-previous", async () => {
        const mark = await writing.step(-1);
        selected = mark?.from ?? selected;
        void render();
      }),
      button("ai-action-next", async () => {
        const mark = await writing.step(1);
        selected = mark?.from ?? selected;
        void render();
      }),
    );
    fresh.append(head);

    const visible = all.filter((item) => shown(item.status));
    if (all.length === 0) {
      fresh.append(el("p", "yaz-ai-empty", t("ai-empty")));
    } else if (visible.length === 0) {
      fresh.append(el("p", "yaz-ai-empty", t("ai-all-done")));
    }

    const list = el("ul", "yaz-ai-list");
    for (const { mark, status } of visible) {
      const item = el("li", `yaz-ai-item yaz-ai-${status}`);
      const row = el("button", "yaz-ai-row");
      row.type = "button";
      row.append(
        el("span", "yaz-ai-line", t("ai-line", { line: lineOf(text, mark.from) })),
        el("span", "yaz-ai-excerpt", mark.body.replace(/\s+/g, " ").trim()),
        el("span", `yaz-ai-status yaz-ai-status-${status}`, t(`ai-status-${status}`)),
      );
      row.addEventListener("click", () => {
        selected = selected === mark.from ? null : mark.from;
        writing.reveal(mark);
        void render();
      });
      item.append(row);
      if (selected === mark.from) await renderDetail(mark, status, item);
      list.append(item);
    }
    fresh.append(list);
    await renderGuide(fresh);
    if (!destroyed) root.replaceChildren(fresh);
  }

  function later(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void render();
    }, SETTLE_MS);
  }

  const unsubscribe = writing.onChange(() => {
    highlights.clear();
    void render();
  });
  void render();

  return {
    update: later,
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      root.remove();
    },
  };
}
