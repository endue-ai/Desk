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
  terminals: [] as Array<{ titleChanged: (title: string) => void }>,
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
    constructor() {
      mocks.terminals.push(this);
    }
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
});
