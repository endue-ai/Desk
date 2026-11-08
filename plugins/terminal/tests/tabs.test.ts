// @vitest-environment jsdom
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
    loadAddon() {}
    open(pane: HTMLElement) {
      pane.append(this.input);
    }
    onData() {}
    onResize() {}
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
  FitAddon: class {
    fit() {}
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
const label = (id: number) => {
  const element = document.querySelector<HTMLButtonElement>(`#tab-t-${id}`);
  if (!element) throw new Error(`No tab ${id}`);
  return element;
};
const input = (id: number) => {
  const element = document.querySelector<HTMLTextAreaElement>(`#pane-t-${id} textarea`);
  if (!element) throw new Error(`No terminal ${id}`);
  return element;
};
const press = (element: HTMLElement, key: string, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  element.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  mocks.terminals.length = 0;
  document.body.innerHTML =
    /<body>([\s\S]*)<\/body>/.exec(html)?.[1]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "";
  vi.stubGlobal("requestAnimationFrame", () => 1);
});

async function mounted() {
  const host = createTestHost({
    pluginId: "endue.terminal",
    handlers: { ...processes(), "init.get": () => ({ profile: "default", settings: {} }) },
    commands: desk(),
  });
  // The browser supplies the SDK import through an import map. Execute the actual main module's
  // body with its imports supplied by the test, so this also exercises its view-to-app wiring.
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
  await host.command("endue.terminal.new");
  await host.command("endue.terminal.new");
  return host;
}

describe("terminal tabs", () => {
  it("clicking a tab shows it and focuses its terminal", async () => {
    await mounted();
    label(1).click();
    expect(label(1).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input(1));
  });

  it("moves selection and label focus with arrows, Home and End, and Enter focuses the terminal", async () => {
    await mounted();
    label(3).focus();
    for (const [key, id] of [
      ["ArrowRight", 1],
      ["ArrowLeft", 3],
      ["Home", 1],
      ["End", 3],
    ] as const) {
      const event = press(document.activeElement as HTMLElement, key);
      expect(event.defaultPrevented).toBe(true);
      expect(label(id).getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(label(id));
      expect(label(id).tabIndex).toBe(0);
      expect(document.querySelector(`#pane-t-${id}`)?.hasAttribute("hidden")).toBe(false);
    }
    press(label(3), "Enter");
    expect(document.activeElement).toBe(input(3));
  });

  it("keeps full titles on the label when a terminal opens and when its title changes", async () => {
    const host = await mounted();
    const title = "A terminal title longer than twenty-four characters";
    await host.command("endue.terminal.run", { command: "git", title });
    expect(label(4).title).toBe(title);
    const changed = "A new terminal title that is also much longer than twenty-four characters";
    mocks.terminals[3]?.titleChanged(changed);
    expect(label(4).title).toBe(changed);
  });

  it("F2 renames a tab in place, and the shell's titles no longer change it", async () => {
    await mounted();
    label(1).focus();
    press(label(1), "F2");
    const field = document.querySelector<HTMLInputElement>("#tabs .tab-rename");
    if (!field) throw new Error("no rename field");
    expect(document.activeElement).toBe(field);
    field.value = "build";
    press(field, "Enter");
    expect(label(1).title).toBe("build");
    expect(document.querySelector("#tabs .tab-rename")).toBeNull();
    mocks.terminals[0]?.titleChanged("vim");
    expect(label(1).title).toBe("build");
  });

  it("Shift+Arrow moves a tab along the strip", async () => {
    await mounted();
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("#tabs .tab")].map((tab) => tab.dataset.id);
    label(1).focus();
    press(label(1), "ArrowRight", { shiftKey: true });
    expect(order()).toEqual(["t-2", "t-1", "t-3"]);
    expect(document.activeElement).toBe(label(1));
    press(label(1), "ArrowLeft", { shiftKey: true });
    expect(order()).toEqual(["t-1", "t-2", "t-3"]);
  });

  it("a notification from a tab out of sight puts an unread badge on it until it shows", async () => {
    const host = await mounted();
    mocks.terminals[0]?.osc.get(9)?.("Build finished");
    for (let i = 0; i < 3; i++) await host.settle();
    const badge = document.querySelector<HTMLElement>("#tab-t-1 .unread");
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe("1");
    expect(label(1).getAttribute("aria-label")).toMatch(/, 1 unread$/);
    label(1).click();
    expect(badge?.hidden).toBe(true);
  });

  it("an ended program shows a banner whose Restart starts it again", async () => {
    const host = await mounted();
    host.emit({ event: "proc.exit", data: { procId: "p1", code: 1 } });
    for (let i = 0; i < 3; i++) await host.settle();
    const note = document.querySelector("#pane-t-1 .pane-note");
    expect(note?.textContent).toMatch(/exited with code 1\./);
    expect(
      document.querySelector('#tabs .tab[data-id="t-1"]')?.classList.contains("is-ended"),
    ).toBe(true);
    const restart = [...(note?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Restart",
    );
    restart?.click();
    for (let i = 0; i < 6; i++) await host.settle();
    expect(document.querySelector("#pane-t-1 .pane-note")).toBeNull();
    expect(host.calls.filter((call) => call.method === "proc.spawn")).toHaveLength(4);
  });

  it("a paste of several lines asks before it goes in", async () => {
    await mounted();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "make\nmake test" } });
    input(3).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const note = document.querySelector("#pane-t-3 .pane-note");
    expect(note?.textContent).toContain("Paste 2 lines?");
    expect(mocks.terminals[2]?.pasted).toEqual([]);
    [...(note?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent === "Paste")
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.terminals[2]?.pasted).toEqual(["make\nmake test"]);
  });

  it("right-click opens the menu, and its Find opens the search bar", async () => {
    await mounted();
    const pane = document.querySelector<HTMLElement>("#pane-t-3");
    const click = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    pane?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const items = [...document.querySelectorAll<HTMLButtonElement>(".terminal-menu .menu-item")];
    expect(items.map((item) => item.querySelector("span")?.textContent)).toEqual([
      "Copy",
      "Paste",
      "Select all",
      "Clear",
      "Find",
      "Rename tab",
    ]);
    expect(items[0]?.disabled).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    items[4]?.click();
    expect(document.querySelector(".terminal-menu")).toBeNull();
    expect(document.querySelector<HTMLElement>("#search")?.hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("#search input"));
  });
});
