// @vitest-environment jsdom
// The page with the plugin behind it (#162, ADR 0176): a Data window that slept comes back as it was
// shown, with the same nodes open, the same one selected and the same mode, and its unsaved value.
import { afterEach, describe, expect, it, vi } from "vitest";
import { disk, file, mountPage } from "./harness";

const A = file("~/data/a.json");
const TEXT = '{ "list": [1, 2, 3], "obj": { "x": 1 }, "s": "text" }';
const DESK = { "desk.buffers.update": () => undefined };

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
const rows = () => [...document.querySelectorAll<HTMLElement>("#tree [role=treeitem]")];
const keyText = (row?: HTMLElement) => row?.querySelector(".key")?.textContent;
const rowOf = (key: string) => {
  const row = rows().find((r) => keyText(r) === key);
  if (!row) throw new Error(`no row ${key}: ${rows().map(keyText).join(" ")}`);
  return row;
};
const selected = () => keyText(rows().find((r) => r.getAttribute("aria-selected") === "true"));
const pressed = () =>
  ["tree", "raw", "both"].find((m) => $(`#mode-${m}`).getAttribute("aria-pressed") === "true");

const width = (px: number) =>
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true });
afterEach(() => width(1024));

describe("a page that slept", () => {
  it("comes back with the same nodes open, the same one selected, its mode and its unsaved value", async () => {
    const first = await mountPage({ handlers: disk({ [A.path]: TEXT }), commands: DESK });
    await first.host.command("desk.files.visit", A);
    rowOf("obj").querySelector<HTMLElement>(".twisty")?.click();
    rowOf("x").click();
    $("#mode-tree").click();
    // x set to 2 from its editor, not saved.
    await first.app.edit([0, 1, 0], "2");
    const { state } = (await first.host.surfaceState()) as { state: unknown };

    const second = await mountPage({
      handlers: disk({ [A.path]: TEXT }),
      commands: DESK,
      restored: state,
    });
    await vi.waitFor(() => expect(selected()).toBe("x"));
    expect(rowOf("obj").getAttribute("aria-expanded")).toBe("true");
    expect(rowOf("x").textContent).toContain("2");
    expect(pressed()).toBe("tree");
    expect($("#raw-pane").hidden).toBe(true);
    expect(second.ran("desk.buffers.update")).toEqual([]);
  });
});
