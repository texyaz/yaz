/**
 * The narrow layout's promises, as far as they can be kept without a layout
 * engine: every pane is mounted exactly once (the editor is one component and
 * must not be drawn twice), and the bar asks rather than decides.
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";

import Compact from "./Compact.svelte";

const content = createRawSnippet<[string]>((tab) => ({
  render: () => `<div data-testid="tab-${tab()}"></div>`,
}));

function mount(overrides: Record<string, unknown> = {}) {
  const props = {
    pane: "editor" as const,
    onpane: vi.fn(),
    sideTabs: ["outline", "files", "search"],
    sideTab: "outline",
    onsidetab: vi.fn(),
    titles: { outline: "Outline", files: "Files", search: "Search" },
    content,
    rich: true,
    onrich: vi.fn(),
    compiling: false,
    canCompile: true,
    oncompile: vi.fn(),
    ...overrides,
  };
  render(Compact, { props });
  return props;
}

describe("the narrow workspace", () => {
  it("mounts the side tab, the editor and the PDF once each", () => {
    mount();
    for (const tab of ["outline", "editor", "pdf"]) {
      expect(screen.getAllByTestId(`tab-${tab}`)).toHaveLength(1);
    }
    expect(screen.queryByTestId("tab-files")).toBeNull();
  });

  it("asks for a pane when its button is pressed", async () => {
    const props = mount();
    await fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(props.onpane).toHaveBeenCalledWith("pdf");
  });

  it("asks for a side tab, and for the preview to be switched", async () => {
    const props = mount();
    await fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(props.onsidetab).toHaveBeenCalledWith("files");

    await fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(props.onrich).toHaveBeenCalledOnce();
  });

  it("cannot compile twice at once, or switch a preview that does not exist", () => {
    mount({ compiling: true, onrich: undefined, rich: false });
    expect(screen.getByRole("button", { name: "Compiling…" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Source" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("puts a problem away when it is tapped", async () => {
    const ondismiss = vi.fn();
    mount({ problem: "The compile failed.", ondismiss });
    await fireEvent.click(screen.getByText("The compile failed."));
    expect(ondismiss).toHaveBeenCalledOnce();
  });
});
