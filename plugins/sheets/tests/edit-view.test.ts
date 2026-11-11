// @vitest-environment jsdom
// The page with the plugin behind it, on the SDK's test host: the edit tier on the surface, the
// formula bar editing the active cell, the grid showing the edit and the unsaved mark (ADR 0071).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineUiPlugin, keepFiles, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { defineElements } from "../../../packages/ui/src/elements/index";
import { openBook } from "../ui/book.js";
import { createSheets, type Sheets } from "../ui/sheets.js";
import { createView } from "../ui/view.js";
import { disk, file, fixture } from "./harness";

defineElements();

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const A = file("~/Documents/cities.csv");
const X = file("~/Documents/budget.xlsx");

afterEach(() => document.body.replaceChildren());

/**
 * The plugin's page in jsdom with an 800 by 600 grid, mounted on the test host; `restored` is
 * what the last sleep kept.
 */
async function page(files: Record<string, Uint8Array>, restored?: unknown) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const script of parsed.querySelectorAll("script")) script.remove();
  document.body.replaceWith(document.importNode(parsed.body, true));
  const scroller = document.getElementById("grid-scroll") as HTMLElement;
  Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
  const host = createTestHost({
    pluginId: "endue.sheets",
    handlers: { "init.get": () => ({ profile: "default", settings: {} }), ...disk(files) },
    commands: { "desk.files.changed": () => "", "desk.buffers.update": () => ({}) },
    ...(restored === undefined ? {} : { restored }),
  });
  let app: Sheets | undefined;
  const view = createView(document, {
    edit: (r, c, text) => app?.edit(r, c, text) ?? false,
    refused: (buffer, r, c) => app?.refused(buffer, r, c),
  });
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createSheets(ctx, view, { read: readBytes, open: openBook, keepFiles });
      },
    },
    host.transport,
  );
  for (let i = 0; i < 4; i++) await host.settle();
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const grid = byId("grid");
  const bar = byId("cell-content") as HTMLInputElement;
  const tier = document.querySelector("desk-edit-tier") as HTMLElement;
  const press = (key: string, target: Element = grid, mods: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
    target.dispatchEvent(event);
    return event;
  };
  const type = (text: string) => {
    bar.value = text;
    bar.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const cell = (r: number, c: number) =>
    grid.querySelector(`[aria-rowindex="${r + 2}"] [aria-colindex="${c + 2}"]`)?.textContent;
  const label = () => tier.shadowRoot?.querySelector(".label")?.textContent;
  return { host, grid, bar, tier, press, type, cell, label, byId };
}

describe("editing a CSV on its page", () => {
  it("shows the tier, edits the active cell in the formula bar and marks it unsaved", async () => {
    const files = { [A.path]: fixture("crlf-bom-quotes.csv") };
    const { host, grid, bar, tier, press, type, cell, label, byId } = await page(files);
    await host.command("desk.files.visit", A);
    expect(tier.hidden).toBe(false);
    expect(label()).toBe("CSV · Lossless editing");
    expect(byId("book-mark").hidden).toBe(true);
    expect([bar.readOnly, grid.getAttribute("aria-readonly")]).toEqual([false, "false"]);

    press("ArrowDown");
    expect([byId("cell-address").textContent, bar.value]).toEqual(["A2", "Seoul, KR"]);
    expect(press("F2").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bar);
    expect(bar.readOnly).toBe(false);
    type("Seoul, South Korea");
    expect(press("Enter", bar).defaultPrevented).toBe(true);
    expect(cell(1, 0)).toBe("Seoul, South Korea");
    expect(byId("cell-address").textContent).toBe("A3");
    expect(document.activeElement).toBe(grid);
    expect(byId("book-mark").hidden).toBe(false);

    // Typing on the grid starts an edit with that character; Escape leaves the cell as it was.
    press("C");
    expect([document.activeElement, bar.value]).toEqual([bar, "C"]);
    press("Escape", bar);
    expect([document.activeElement, bar.value, cell(2, 0)]).toEqual([grid, "Busan", "Busan"]);

    // Mod+S reaches the desk from the bar: the save takes the edit in progress.
    press("F2");
    type("Ulsan");
    expect(press("s", bar, { metaKey: true }).defaultPrevented).toBe(false);
    await host.command("desk.files.save", A);
    expect([cell(2, 0), byId("book-mark").hidden]).toEqual(["Ulsan", true]);
    const saved = new TextDecoder().decode(files[A.path]);
    expect(saved).toContain('"Seoul, South Korea",Korea');
    expect(saved).toContain("\r\nUlsan,Korea,3.4,");
  });

  it("past a row's last field the formula bar stays read-only, and the status line says why", async () => {
    const { host, bar, press, byId } = await page({ [A.path]: fixture("crlf-bom-quotes.csv") });
    await host.command("desk.files.visit", A);
    for (let i = 0; i < 4; i++) press("ArrowRight");
    press("F2");
    expect([bar.readOnly, document.activeElement === bar]).toEqual([true, false]);
    expect(byId("status").textContent).toBe(
      "E1 is not in cities.csv: only its own cells are edited.",
    );
  });
});

describe("a format Sheets only reads", () => {
  it("an .xlsx says Read-only, its formula bar stays read-only, and typing says why (#162)", async () => {
    const { host, grid, bar, label, press, byId } = await page({
      [X.path]: fixture("budget.xlsx"),
    });
    await host.command("desk.files.visit", X);
    expect(label()).toBe("XLSX · Read-only");
    expect(press("F2").defaultPrevented).toBe(false);
    expect(byId("status").textContent).toBe("Sheets opens XLSX files read-only.");
    press("q");
    expect([bar.readOnly, document.activeElement]).toEqual([true, grid]);
  });

  it("typing into a CSV that is not UTF-8 says that it is read-only and why (#162)", async () => {
    const K = file("~/Documents/notes-euc-kr.csv");
    const { host, grid, label, press, byId } = await page({
      [K.path]: fixture("notes-euc-kr.csv"),
    });
    await host.command("desk.files.visit", K);
    expect(label()).toBe("CSV · Read-only");
    expect(byId("status").textContent).toBe("Opened notes-euc-kr.csv: 1 sheet.");
    press("ArrowDown");
    press("가");
    expect(document.activeElement).toBe(grid);
    expect(byId("status").textContent).toBe(
      "Sheets saves CSV and TSV files in UTF-8 only; this one is EUC-KR, so it opens for reading.",
    );
  });
});

describe("the header and the tabs at small sizes (#162)", () => {
  it("a book of one sheet marks its tab row single, a workbook of two does not; the cut name is whole on hover", async () => {
    const files = { [A.path]: fixture("crlf-bom-quotes.csv"), [X.path]: fixture("budget.xlsx") };
    const { host, byId } = await page(files);
    await host.command("desk.files.visit", A);
    expect(byId("tabs").hasAttribute("data-single")).toBe(true);
    expect(byId("book-name").title).toBe("cities.csv");
    await host.command("desk.files.visit", X);
    expect(byId("tabs").hasAttribute("data-single")).toBe(false);
    expect(byId("book-detail").title).toBe(byId("book-detail").textContent);
  });
});

describe("a page that slept (#162)", () => {
  it("comes back on the cell, the scroll and the zoom it was left at, with the unsaved edit marked", async () => {
    const files = { [A.path]: fixture("crlf-bom-quotes.csv") };
    const first = await page(files);
    await first.host.command("desk.files.visit", A);
    first.press("ArrowDown");
    first.press("F2");
    first.type("Seoul, South Korea");
    first.press("Enter", first.bar);
    first.press("ArrowRight");
    first.byId("grid-scroll").scrollTop = 40;
    first.press("=", first.grid, { metaKey: true });
    const state = ((await first.host.surfaceState()) as { state: unknown }).state;

    const second = await page(files, state);
    await vi.waitFor(() => expect(second.byId("cell-address").textContent).toBe("B3"));
    expect(second.byId("grid-scroll").scrollTop).toBe(40);
    expect(second.byId("grid-layer").style.fontSize).toBe("calc(var(--desk-text-xs) * 1.1)");
    expect(second.cell(1, 0)).toBe("Seoul, South Korea");
    expect(second.byId("book-mark").hidden).toBe(false);
    // Nothing reached the disk.
    expect(new TextDecoder().decode(files[A.path])).toContain('"Seoul, KR"');
  });
});

describe("copying a selection", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const copy = (target: Element) => {
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    target.dispatchEvent(event);
    return { event, setData };
  };

  it("copies B2:C3 as tab-separated rows", async () => {
    const { host, grid, press } = await page({
      [A.path]: bytes("a1,b1,c1\na2,b2,c2\na3,b3,c3"),
    });
    await host.command("desk.files.visit", A);
    grid.focus();
    press("ArrowDown");
    press("ArrowRight");
    press("ArrowDown", grid, { shiftKey: true });
    press("ArrowRight", grid, { shiftKey: true });
    const { event, setData } = copy(grid);
    expect(setData).toHaveBeenCalledExactlyOnceWith("text/plain", "b2\tc2\nb3\tc3");
    expect(event.defaultPrevented).toBe(true);
  });

  it("quotes tabs, quotes and newlines in cell text", async () => {
    const { host, grid, press } = await page({
      [A.path]: bytes('"tab\tvalue","say ""hi""","two\nlines"'),
    });
    await host.command("desk.files.visit", A);
    grid.focus();
    press("ArrowRight", grid, { shiftKey: true });
    press("ArrowRight", grid, { shiftKey: true });
    const { event, setData } = copy(grid);
    expect(setData).toHaveBeenCalledExactlyOnceWith(
      "text/plain",
      '"tab\tvalue"\t"say ""hi"""\t"two\nlines"',
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves copying inside the open cell editor to the editor", async () => {
    const { host, grid, bar, press } = await page({ [A.path]: bytes("a1,b1") });
    await host.command("desk.files.visit", A);
    grid.focus();
    press("F2");
    expect(document.activeElement).toBe(bar);
    const { event, setData } = copy(bar);
    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
