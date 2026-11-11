// @vitest-environment jsdom
// The row Enter runs is the first one until the person moves the selection, and the list a person
// sees first is ordered for them (#158: draft 04 findings 11 and 12).
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Command, mount } from "./harness";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const plugin = (id: string, title: string) => ({
  id: `plugin:${id}`,
  kind: "plugin",
  title,
  plugin: id,
});

describe("the first row is the selected one", () => {
  it("term + Enter opens the Terminal when its plugin's hit arrives ahead of the commands", async () => {
    const palette = await mount({
      commands: [
        // The registry's order: Docker lists "terminal" among its keywords only.
        {
          id: "endue.docker.shell",
          title: "Docker: open a shell in the container",
          keywords: ["exec", "terminal"],
        },
        { id: "endue.terminal.new", title: "New terminal", keywords: ["shell"] },
      ],
    });
    palette.type("term");
    expect(palette.selected()?.dataset.id).toBe("endue.terminal.new");
    await vi.advanceTimersByTimeAsync(120);
    palette.plugins.resolve({ hits: [plugin("endue.terminal", "Terminal")] });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.ids()).toEqual([
      "plugin:endue.terminal",
      "endue.terminal.new",
      "endue.docker.shell",
    ]);
    expect(palette.selected()?.dataset.id).toBe("plugin:endue.terminal");
    expect(palette.list.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe(
      "true",
    );
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.run).toHaveBeenCalledWith("desk.plugins.open", {
      plugin: "endue.terminal",
      waitForReady: false,
    });
    expect(palette.run).not.toHaveBeenCalledWith("endue.docker.shell", {});
  });

  it("sett + Enter opens Settings, not a command that only lists settings among its keywords", async () => {
    const keywords = ["settings", "preferences", "keyboard", "shortcuts"];
    const palette = await mount({
      commands: [
        { id: "desk.shell.open-keys", title: "Settings · keyboard shortcuts", keywords },
        { id: "desk.settings.keyboard", title: "Keyboard Shortcuts", keywords },
        { id: "desk.market.open", title: "Market", keywords },
        { id: "desk.connectors.open", title: "Connections", keywords },
        { id: "desk.settings.open", title: "Settings", keywords },
      ],
    });
    palette.type("sett");
    expect(palette.ids().slice(0, 2)).toEqual(["desk.settings.open", "desk.shell.open-keys"]);
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.run).toHaveBeenCalledWith("desk.settings.open", {});
  });
});

describe("the first list", () => {
  const commands: Command[] = [
    { id: "desk.keys.conflicts", title: "List key binding conflicts" },
    {
      id: "desk.frames.stop",
      title: "Not responding · stop",
      argsSchema: {
        type: "object",
        properties: { plugin: { type: "string" } },
        required: ["plugin"],
      },
    },
    { id: "desk.shell.desktop-10", title: "Desktop · 10" },
    { id: "desk.settings.open", title: "Settings" },
    { id: "desk.shell.desktop-2", title: "Desktop · 2" },
    { id: "desk.inbox.open", title: "Inbox" },
  ];
  const index = async (query: string) => ({
    hits: query
      ? []
      : [
          plugin("endue.calendar", "Calendar"),
          { id: "document:endue.notes:a", kind: "document", title: "a.md", plugin: "endue.notes" },
          plugin("endue.terminal", "Terminal"),
        ],
  });

  it("is what the person used last, then the plugins, then the commands A to Z, at once", async () => {
    const palette = await mount({ commands, history: ["desk.settings.open"], pluginSearch: index });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.sections()).toEqual([
      ["Recent", ["desk.settings.open"]],
      ["Plugins", ["plugin:endue.calendar", "plugin:endue.terminal"]],
      [
        "Commands",
        ["desk.shell.desktop-2", "desk.shell.desktop-10", "desk.inbox.open", "desk.keys.conflicts"],
      ],
    ]);
    expect(palette.selected()?.dataset.id).toBe("desk.settings.open");
    // Every plugin, whatever the index holds besides them.
    expect(palette.call).toHaveBeenCalledWith("search.query", {
      query: "",
      limit: 100,
      scope: { permission: "search:read" },
    });
  });

  it("does not list a command the palette cannot run: one that needs args", async () => {
    const palette = await mount({ commands, pluginSearch: index });
    palette.type("not responding");
    expect(palette.ids()).not.toContain("desk.frames.stop");
  });

  it("puts a plugin opened from here first next time", async () => {
    const palette = await mount({ commands, pluginSearch: index });
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.selected()?.dataset.id).toBe("plugin:endue.calendar");
    palette.key("Enter");
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.call).toHaveBeenCalledWith("store.set", {
      key: "history",
      value: ["plugin:endue.calendar"],
    });
    await palette.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(palette.sections()[0]).toEqual(["Recent", ["plugin:endue.calendar"]]);
  });

  it("closes when its key is pressed again while it is open, and opens afresh after", async () => {
    const palette = await mount();
    palette.type("term");
    await palette.open();
    expect(palette.surface.hide).toHaveBeenCalledTimes(1);
    await palette.open();
    expect(palette.surface.show).toHaveBeenCalledTimes(2);
    expect(palette.input.value).toBe("");
  });
});
