// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createBuilder } from "../ui/builder.js";

// The view builder on jsdom over the SDK's test host (ADR 0102): a source loaded once, the shape and
// the fields redrawing the preview without loading again, and Save writing the view with view.save.
const BOARD = `title: Launch
entries:
  - { id: a, name: Write the post, column: doing, due: 2026-11-02 }
  - { id: b, name: Record the demo, column: todo, due: 2026-11-04 }
`;
const VIEWS = { permission: "view:manage" } as const;
const FILES = { permission: "fs:read" as const, paths: ["~/boards/**"] };

async function mount() {
  const host = createTestHost({
    pluginId: "desk.universal",
    files: { "~/boards/launch.yaml": BOARD, "~/private/plan.yaml": BOARD },
    grants: [VIEWS, FILES],
  });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  const page = document.createElement("main");
  document.body.append(page);
  const saved = vi.fn();
  const cancelled = vi.fn();
  const builder = createBuilder(page, ctx, { saved, cancelled });
  const reads = () => host.calls.filter((c) => c.method === "fs.read").length;
  const $ = <T extends Element = HTMLElement>(selector: string) => {
    const found = page.querySelector<T>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };
  return { host, ctx, page, builder, saved, cancelled, reads, $ };
}

describe("the view builder", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("loads a file, suggests the fields, and the shape and fields redraw the preview without a reload", async () => {
    const m = await mount();
    await m.builder.start(undefined);
    m.$<HTMLInputElement>('input[aria-label="Where"]').value = "~/boards/launch.yaml";
    m.$<HTMLButtonElement>(".build-step button.desk-btn:not(.desk-tab)").click();
    await vi.waitFor(() => expect(m.builder.preview.getAttribute("state")).toBe("ready"));
    expect(m.$(".build-status").textContent).toContain("2 entries");
    const data = m.builder.preview.data;
    expect(m.reads()).toBe(1);
    expect(m.$<HTMLInputElement>('input[aria-label="Name"]').value).toBe("Launch");
    // Suggested: name plays title, column the group, due the start.
    expect(m.builder.state.map).toEqual({ title: "name", group: "column", start: "due" });

    m.$<HTMLButtonElement>('[data-shape="kanban"]').click();
    expect(m.$('[data-shape="kanban"]').getAttribute("aria-pressed")).toBe("true");
    expect(m.builder.preview.view).toMatchObject({ type: "kanban", map: { group: "column" } });
    const group = m.$<HTMLSelectElement>('select[data-role="group"]');
    expect([...group.options].map((o) => o.value)).toContain("column");
    group.value = "";
    group.dispatchEvent(new Event("change"));
    expect(m.builder.preview.view).toMatchObject({ type: "kanban" });
    expect((m.builder.preview.view as { map?: object }).map).not.toHaveProperty("group");

    m.$<HTMLButtonElement>('[data-shape="timeline"]').click();
    expect(m.builder.preview.view).toMatchObject({ type: "timeline", map: { start: "due" } });
    // The same data the whole time: shapes and fields never read the source again.
    expect(m.builder.preview.data).toBe(data);
    expect(m.reads()).toBe(1);
  });

  it("Save writes the view under my.<slug> with view.save, -2 when taken, and hands it on", async () => {
    const m = await mount();
    await m.ctx.views.save({ id: "my.launch", type: "list", source: { data: { entries: [] } } });
    await m.builder.start(undefined);
    m.$<HTMLInputElement>('input[aria-label="Where"]').value = "~/boards/launch.yaml";
    await m.builder.load();
    m.builder.shape("kanban");
    m.$<HTMLButtonElement>(".build-actions .desk-btn-primary").click();
    await vi.waitFor(() => expect(m.saved).toHaveBeenCalledOnce());
    const view = m.saved.mock.calls[0]?.[0];
    expect(view).toMatchObject({
      id: "my.launch-2",
      title: "Launch",
      type: "kanban",
      source: { file: "~/boards/launch.yaml" },
      map: { title: "name", group: "column", start: "due" },
    });
    expect(await m.ctx.views.get("my.launch-2")).toEqual(view);
  });

  it("edits a saved view in place: its source loaded, its shape and fields shown, saved under its id", async () => {
    const m = await mount();
    const kept = {
      id: "my.launch",
      title: "Launch",
      type: "timeline" as const,
      source: { file: "~/boards/launch.yaml" },
      map: { start: "due" },
    };
    await m.builder.start(kept);
    expect(m.builder.preview.getAttribute("state")).toBe("ready");
    expect(m.$('[data-shape="timeline"]').getAttribute("aria-pressed")).toBe("true");
    expect(m.$<HTMLSelectElement>('select[data-role="start"]').value).toBe("due");
    await m.builder.save();
    expect(m.saved.mock.calls[0]?.[0]).toMatchObject({ id: "my.launch", type: "timeline" });
  });

  it("says what is wrong with a source, asks for a refused one, and Cancel hands back", async () => {
    const m = await mount();
    await m.builder.start(undefined);
    m.$<HTMLInputElement>('input[aria-label="Where"]').value = "boards/launch.yaml";
    await m.builder.load();
    expect(m.$(".build-status").textContent).toContain("~/");
    m.builder.pick("url");
    expect(m.$('[data-source="url"]').getAttribute("aria-selected")).toBe("true");
    m.builder.pick("file");
    m.$<HTMLInputElement>('input[aria-label="Where"]').value = "~/private/plan.yaml";
    await m.builder.load();
    expect(m.builder.preview.getAttribute("state")).toBe("denied");
    expect(m.$(".build-status").textContent).toContain("permission");
    const allow = [...m.page.querySelectorAll<HTMLButtonElement>(".build-step .desk-btn")].find(
      (b) => b.textContent === "Allow",
    );
    expect(allow?.hidden).toBe(false);
    allow?.click();
    await vi.waitFor(() => expect(m.builder.preview.getAttribute("state")).toBe("ready"));
    m.$<HTMLButtonElement>(".build-actions .desk-btn-quiet").click();
    expect(m.cancelled).toHaveBeenCalledOnce();
  });
});
