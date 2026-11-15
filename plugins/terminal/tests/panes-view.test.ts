// @vitest-environment jsdom
// The terminal's split panes in the page (#315): a tab's panes and dividers drawn from its layout,
// the pane in use marked, a divider's drag resizing the panes and refitting every terminal (so each
// PTY gets its size), a press giving a pane the focus, and the menu's Split right, Split down and
// Close pane. main.js runs with xterm replaced, as in tabs.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { wireCommands } from "../ui/commands.js";
import { decide } from "../ui/keys.js";
import { createTerminals } from "../ui/sessions.js";
import { DEFAULTS, platformOf } from "../ui/shell.js";
import { THEME_VARIABLES, terminalOptions } from "../ui/theme.js";
import { createView } from "../ui/view.js";
import { desk, processes } from "./harness";

const mocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    titleChanged: (title: string) => void;
    osc: Map<number, (data: string) => boolean>;
    pasted: string[];
    fits: number;
  }>,
}));

// Replace xterm with a focusable input in jsdom.
vi.mock("../ui/vendor/xterm.mjs", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    unicode = { activeVersion: "" };
    options = {};
    input = document.createElement("textarea");
    titleChanged = (_title: string) => {};
    osc = new Map<number, (data: string) => boolean>();
    pasted: string[] = [];
    fits = 0;
    pane: HTMLElement | null = null;
    resized = (_size: { cols: number; rows: number }) => {};
    modes = { bracketedPasteMode: false };
    parser = {
      registerOscHandler: (code: number, handler: (data: string) => boolean) => {
        this.osc.set(code, handler);
        return { dispose() {} };
      },
    };
    constructor() {
      mocks.terminals.push(this);
    }
    get textarea() {
      return this.input;
    }
    paste(text: string) {
      this.pasted.push(text);
    }
    getSelection() {
      return "";
    }
    selectAll() {}
    loadAddon(addon: { term?: unknown }) {
      addon.term = this;
    }
    open(pane: HTMLElement) {
      this.pane = pane;
      pane.append(this.input);
    }
    onData() {}
    onResize(callback: (size: { cols: number; rows: number }) => void) {
      this.resized = callback;
    }
    onTitleChange(callback: (title: string) => void) {
      this.titleChanged = callback;
    }
    onBell() {}
    onSelectionChange() {}
    attachCustomKeyEventHandler() {}
    focus() {
      this.input.focus();
    }
    dispose() {}
    write() {}
    clear() {}
    hasSelection() {
      return false;
    }
  },
}));
vi.mock("../ui/vendor/addon-fit.mjs", () => ({
  // A fit gives a terminal one column per percent of the tab's width its pane has.
  FitAddon: class {
    term:
      | {
          pane: HTMLElement | null;
          cols: number;
          rows: number;
          fits: number;
          resized: (size: { cols: number; rows: number }) => void;
        }
      | undefined;
    fit() {
      const term = this.term;
      if (!term?.pane) return;
      term.fits += 1;
      const cols = Math.round(Number.parseFloat(term.pane.style.width || "100"));
      if (cols === term.cols) return;
      term.cols = cols;
      term.resized({ cols, rows: term.rows });
    }
  },
}));
vi.mock("../ui/vendor/addon-unicode11.mjs", () => ({ Unicode11Addon: class {} }));
vi.mock("../ui/vendor/addon-search.mjs", () => ({
  SearchAddon: class {
    findNext() {
      return true;
    }
    findPrevious() {
      return true;
    }
    clearDecorations() {}
    onDidChangeResults() {
      return { dispose() {} };
    }
  },
}));
vi.mock("../ui/vendor/addon-web-links.mjs", () => ({ WebLinksAddon: class {} }));

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const $ = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No ${selector}`);
  return element;
};
const pointer = (target: Element, type: string, x: number, y: number) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }),
  );
const menuItems = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".terminal-menu .menu-item")].map((item) => ({
    item,
    label: item.querySelector("span")?.textContent,
  }));

beforeEach(() => {
  mocks.terminals.length = 0;
  document.body.innerHTML =
    /<body>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => {
    run();
    return 1;
  });
  // jsdom lays nothing out: every box is 800 by 400 pixels, from the page's top left.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 400,
    width: 800,
    height: 400,
    toJSON: () => ({}),
  });
});

async function mounted() {
  const host = createTestHost({
    pluginId: "endue.terminal",
    handlers: { ...processes(), "init.get": () => ({ profile: "default", settings: {} }) },
    commands: desk(),
  });
  const main = readFileSync(join(import.meta.dirname, "../ui/main.js"), "utf8").replace(
    /^import .*;\n/gm,
    "",
  );
  let ready: Promise<unknown> | undefined;
  const mount = (plugin: Parameters<typeof defineUiPlugin>[0]) => {
    ready = defineUiPlugin(plugin, host.transport);
  };
  new Function(
    "defineUiPlugin",
    "wireCommands",
    "decide",
    "createTerminals",
    "DEFAULTS",
    "platformOf",
    "THEME_VARIABLES",
    "terminalOptions",
    "createView",
    main,
  )(
    mount,
    wireCommands,
    decide,
    createTerminals,
    DEFAULTS,
    platformOf,
    THEME_VARIABLES,
    terminalOptions,
    createView,
  );
  await ready;
  for (let i = 0; i < 6; i++) await host.settle();
  await host.command("endue.terminal.split", { direction: "right" });
  for (let i = 0; i < 6; i++) await host.settle();
  return host;
}

describe("split panes in the page", () => {
  it("draws a tab's panes and dividers from its layout, the pane in use marked", async () => {
    await mounted();
    const panel = $("#panel-t-1");
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("tab-t-1");
    expect($("#pane-t-1").parentElement).toBe(panel);
    expect($("#pane-t-2").parentElement).toBe(panel);
    expect($("#pane-t-1").style).toMatchObject({
      left: "0%",
      top: "0%",
      width: "50%",
      height: "100%",
    });
    expect($("#pane-t-2").style).toMatchObject({ left: "50%", width: "50%" });
    const divider = $(`#panel-t-1 .pane-divider`);
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect($("#pane-t-2").classList.contains("is-active")).toBe(true);
    expect($("#pane-t-1").classList.contains("is-active")).toBe(false);
    // One tab for both panes: the strip stays hidden.
    expect(document.querySelectorAll("#tabs .tab")).toHaveLength(1);
    expect($("#tabs").hidden).toBe(true);
  });

  it("a divider drag resizes the panes and each terminal refits", async () => {
    const host = await mounted();
    const before = mocks.terminals.map((t) => t.fits);
    const divider = $("#panel-t-1 .pane-divider");
    pointer(divider, "pointerdown", 400, 200);
    pointer(divider, "pointermove", 200, 200);
    pointer(divider, "pointerup", 200, 200);
    for (let i = 0; i < 3; i++) await host.settle();
    expect($("#pane-t-1").style.width).toBe("25%");
    expect($("#pane-t-2").style).toMatchObject({ left: "25%", width: "75%" });
    for (const [i, t] of mocks.terminals.entries()) expect(t.fits).toBeGreaterThan(before[i] ?? 0);
    const sizes = host.calls
      .filter((c) => c.method === "proc.resize")
      .map((c) => c.params as { procId: string; size: { cols: number } });
    expect(sizes.filter((s) => s.procId === "p1").at(-1)?.size.cols).toBe(25);
    expect(sizes.filter((s) => s.procId === "p2").at(-1)?.size.cols).toBe(75);
  });

  it("a pointer press on a pane gives it the focus", async () => {
    await mounted();
    pointer($("#pane-t-1"), "pointerdown", 100, 100);
    expect($("#pane-t-1").classList.contains("is-active")).toBe(true);
    expect($("#pane-t-2").classList.contains("is-active")).toBe(false);
    expect(document.activeElement).toBe($("#pane-t-1 textarea"));
  });

  it("the tab's menu has Split right, Split down and Close pane", async () => {
    const host = await mounted();
    const open = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    $("#pane-t-2").dispatchEvent(open);
    expect(open.defaultPrevented).toBe(true);
    expect(menuItems().map((m) => m.label)).toEqual(
      expect.arrayContaining(["Split right", "Split down", "Close pane"]),
    );
    menuItems()
      .find((m) => m.label === "Split down")
      ?.item.click();
    for (let i = 0; i < 6; i++) await host.settle();
    expect($("#pane-t-3").parentElement).toBe($("#panel-t-1"));
    expect($("#pane-t-3").style).toMatchObject({ left: "50%", top: "50%", height: "50%" });

    // The tab's own label opens the same menu for its pane in use.
    await host.command("endue.terminal.new");
    for (let i = 0; i < 6; i++) await host.settle();
    $("#tab-t-1").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    menuItems()
      .find((m) => m.label === "Close pane")
      ?.item.click();
    for (let i = 0; i < 6; i++) await host.settle();
    expect(document.querySelector("#pane-t-3")).toBeNull();
    expect($("#pane-t-2").style).toMatchObject({ top: "0%", height: "100%" });
  });
});
