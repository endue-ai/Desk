// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineUiPlugin, parseYaml } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { viewOf } from "../ui/open.js";
import { canonical, createScreen } from "../ui/screen.js";

// Eris's side of desk.universal (ADR 0073, 0102): the drafting state at once, the preview's Apply,
// Try again with what to change and Discard, and Apply turning the preview into the notice with
// Undo over the very element and data already drawn.
const BOARD = {
  id: "eris.issues-board",
  title: "Issues board",
  type: "kanban" as const,
  types: ["kanban" as const, "list" as const],
  source: { data: { entries: [{ id: "a", title: "One", group: "open" }] } },
};

async function mount() {
  const host = createTestHost({ pluginId: "desk.universal" });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  const ran = vi.spyOn(ctx.commands, "run").mockResolvedValue({});
  const page = document.createElement("main");
  document.body.append(page);
  const screen = createScreen(page, ctx);
  const bar = () => page.querySelector<HTMLElement>(".bar") as HTMLElement;
  const button = (label: string) =>
    [...bar().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { host, ctx, page, screen, bar, button, ran, settle };
}

describe("desk.universal's preview", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows the drafting state with a ghost at once, then the preview's choices over the drawn view", async () => {
    const m = await mount();
    m.screen.drafting("Making a view from “show this repo's issues as a board”…");
    expect(m.bar().hidden).toBe(false);
    expect(m.bar().dataset.mode).toBe("drafting");
    expect(m.bar().textContent).toContain("Making a view");
    expect(m.page.querySelector<HTMLElement>(".ghost")?.hidden).toBe(false);
    expect(m.page.hasAttribute("data-drafting")).toBe(true);

    const choice = m.screen.preview(BOARD, "Eris made this from “show this repo's issues…”.");
    await m.settle();
    expect(m.page.querySelector<HTMLElement>(".ghost")?.hidden).toBe(true);
    expect(m.page.hasAttribute("data-drafting")).toBe(false);
    expect(m.screen.handle?.element.getAttribute("state")).toBe("ready");
    expect(m.bar().dataset.mode).toBe("preview");
    expect([...m.bar().querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Apply",
      "Try again",
      "Discard",
    ]);
    m.button("Apply")?.click();
    expect(await choice).toEqual({ choice: "apply" });
    expect(m.bar().textContent).toContain("Saving");
  });

  it("Try again asks what should change and answers it; Discard and a newer preview discard", async () => {
    const m = await mount();
    const first = m.screen.preview(BOARD, "Eris made this.");
    m.button("Try again")?.click();
    const change = m.bar().querySelector<HTMLInputElement>(".bar-change") as HTMLInputElement;
    expect(change.hidden).toBe(false);
    change.value = "  only open ones ";
    change.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    expect(await first).toEqual({ choice: "retry", correction: "only open ones" });

    const second = m.screen.preview(BOARD, "Eris made this.");
    const third = m.screen.preview(BOARD, "Eris made this again.");
    expect(await second).toEqual({ choice: "discard" });
    m.button("Discard")?.click();
    expect(await third).toEqual({ choice: "discard" });
  });

  it("Apply then open under the same id keeps the element and its data, and the notice runs Undo", async () => {
    const m = await mount();
    void m.screen.preview(BOARD, "Eris made this.");
    await m.settle();
    const drawn = m.screen.handle?.element;
    const data = m.screen.handle?.data;
    // The view as the core reads it back from YAML: the same, its keys in another order.
    const { types, ...rest } = BOARD;
    const saved = { ...rest, types };
    expect(canonical(saved)).toBe(canonical(BOARD));
    const notice = {
      text: "Eris made this view: ~/.desk/views/eris.issues-board.yaml",
      action: {
        title: "Undo",
        command: "desk.propose.undo",
        args: { kind: "view", id: "eris.issues-board" },
      },
    };
    m.screen.open(saved, { notice });
    expect(m.screen.handle?.element).toBe(drawn);
    expect(m.screen.handle?.data).toBe(data);
    expect(m.bar().dataset.mode).toBe("notice");
    m.button("Undo")?.click();
    expect(m.ran).toHaveBeenCalledWith("desk.propose.undo", {
      kind: "view",
      id: "eris.issues-board",
    });
    // Undo closes it by id; another id leaves it be.
    expect(m.screen.close("eris.other")).toBe(false);
    expect(m.screen.close("eris.issues-board")).toBe(true);
    expect(m.page.querySelector("desk-universal-view")).toBeNull();
    expect(m.bar().hidden).toBe(true);
  });

  it("opens one of the person's saved views by id", async () => {
    const io = {
      parse: parseYaml,
      read: async () => "",
      get: async (id: string) => (id === BOARD.id ? BOARD : { id, layout: {} }),
    };
    expect(await viewOf({ id: BOARD.id }, io)).toEqual(BOARD);
    await expect(viewOf({ id: "example.today" }, io)).rejects.toThrow("not a universal view");
  });
});
