import { describe, expect, it } from "vitest";
import { exported } from "../ui/sections.js";
import { ANSWERS, core, EXPORT, mount } from "./harness";

const LABELS = [
  "Render tree",
  "Surfaces and buffers",
  "Commands",
  "Grants",
  "Settings",
  "Plugins",
  "Bridge calls",
];

describe("the inspector", () => {
  it("opens on the commands, newest first, with caller and milliseconds", async () => {
    const { view, methods } = await mount();
    expect(view.lists.at(-1)?.sections.map((s) => s.label)).toEqual(LABELS);
    expect(view.lists.at(-1)?.current).toBe("commands");
    expect(methods()).toContain("cmd.recent");
    const table = view.tables.at(-1);
    expect(table?.summary).toBe("4 invocations, newest first");
    expect(table?.groups[0]?.columns).toEqual([
      "Time (UTC)",
      "Command",
      "Caller",
      "Provider",
      "Duration",
      "Outcome",
    ]);
    expect(table?.groups[0]?.rows).toEqual([
      ["09:00:07.250", "desk.palette.pick", "desk", "desk.palette", "", "waiting"],
      ["09:00:05.500", "endue.git.commit", "cli", "endue.git", "340 ms", "failed"],
      ["09:00:03.000", "desk.theme.toggle", "desk.palette", "desk", "18 ms", "ok"],
      ["09:00:00.120", "desk.palette.open", "desk", "desk.palette", "4 ms", "ok"],
    ]);
  });

  it("refreshes the section in view: core sections every 2 s, the runtime's every 5 s", async () => {
    const { app, timers, methods, settle } = await mount();
    expect(timers.running.map((t) => t.ms)).toEqual([2000]);
    timers.running[0]?.tick();
    await settle();
    expect(methods().filter((m) => m === "cmd.recent")).toHaveLength(2);
    await app.show("settings");
    await settle();
    expect(timers.running.map((t) => t.ms)).toEqual([5000]);
    expect(methods().filter((m) => m === "cmd.invoke desk.inspect.open settings")).toHaveLength(1);
    timers.running[0]?.tick();
    await settle();
    expect(methods().filter((m) => m === "cmd.invoke desk.inspect.open settings")).toHaveLength(2);
  });

  it("shows each section from its source", async () => {
    const { app, view, settle } = await mount();
    await app.show("plugins");
    await settle();
    expect(view.lists.at(-1)?.current).toBe("plugins");
    expect(view.tables.at(-1)?.groups[0]?.rows).toEqual([
      ["desk.palette", "Palette", "ui", "on", "ready"],
      ["endue.sheets", "Sheets", "ui", "off · autoload", "ready"],
      ["endue.terminal", "Terminal", "ui", "on · not responding", "ready"],
      [
        "example.broken",
        "",
        "",
        "off · quarantined",
        "failed: plugin.json: /kind must be one of ui, logic, tool",
      ],
    ]);
    await app.show("settings");
    await settle();
    expect(view.tables.at(-1)?.groups[0]?.rows).toContainEqual([
      "desk.theme.scheme",
      '"light"',
      "init.yaml",
      "desk.theme",
    ]);
    expect(view.tables.at(-1)?.groups[0]?.rows).toContainEqual([
      "desk.notify.seconds",
      "6",
      'profile (skipped: init.yaml "long")',
      "desk.notify",
    ]);
    await app.show("grants");
    await settle();
    expect(view.tables.at(-1)?.groups.map((g) => g.title)).toEqual([
      "desk",
      "desk.inspector",
      "endue.notes",
    ]);
    expect(view.tables.at(-1)?.groups[2]?.rows).toEqual([
      ["g9", "fs:write", "paths: ~/Notes/**", "once"],
    ]);
    await app.show("surfaces");
    await settle();
    expect(view.tables.at(-1)?.groups.map((g) => g.title)).toEqual([
      "Surfaces",
      "Views",
      "Buffers",
    ]);
    expect(view.tables.at(-1)?.groups[2]?.rows[1]).toEqual([
      "plan.md",
      "endue.notes",
      "~/Notes/plan.md",
      "modified",
    ]);
    await app.show("calls");
    await settle();
    expect(view.tables.at(-1)?.summary).toBe("Bridge calls over the last 60 s, by caller");
    expect(view.tables.at(-1)?.groups[0]?.rows[0]).toEqual(["desk", "212", "2"]);
    await app.show("tree");
    await settle();
    expect(view.tables.at(-1)?.groups[0]?.rows.slice(0, 3)).toEqual([
      ["div#desk", "0 0 1440×900", ""],
      ["  main.desk-compositor", "0 0 1440×876", ""],
      ['    section.desk-surface [data-surface="desk.inspector"]', "0 0 1440×876", ""],
    ]);
  });

  it("filters rows by any cell and says how many match", async () => {
    const { app, view } = await mount();
    app.filter("PALETTE");
    expect(view.tables.at(-1)?.summary).toBe("3 of 4 invocations match “PALETTE”");
    expect(view.tables.at(-1)?.groups[0]?.rows.map((r) => r[1])).toEqual([
      "desk.palette.pick",
      "desk.theme.toggle",
      "desk.palette.open",
    ]);
    app.filter("nothing like it");
    expect(view.tables.at(-1)?.summary).toBe("0 of 4 invocations match “nothing like it”");
    app.filter("");
    expect(view.tables.at(-1)?.groups[0]?.rows).toHaveLength(4);
  });

  it("exports the section in view as desk inspect prints it, whatever the filter", async () => {
    const { app, view, settle } = await mount();
    app.filter("palette");
    await app.exportJson();
    await settle();
    const commands = JSON.parse(EXPORT).commands;
    expect(view.exports.at(-1)).toBe(exported({ commands }));
    expect(JSON.parse(view.exports.at(-1) ?? "")).toEqual({ commands });
  });

  it("refreshes plugins on plugin.changed and grants on perm.changed", async () => {
    const { app, host, methods, settle } = await mount();
    await app.show("plugins");
    await settle();
    host.emit({
      event: "plugin.changed",
      data: { plugin: "endue.sheets", change: "enabled", revision: 3 },
    });
    await settle();
    expect(methods().filter((m) => m === "plugin.list")).toHaveLength(2);
    await app.show("grants");
    await settle();
    host.emit({ event: "perm.changed", data: { grantId: "g9", change: "expired" } });
    await settle();
    expect(methods().filter((m) => m === "perm.list")).toHaveLength(2);
  });

  it("keeps the section across reloads and says when a call is refused", async () => {
    const { view } = await mount(core(), {
      state: { section: "calls" },
      refuse: { "plugin.stats": "permission_denied" },
    });
    expect(view.lists.at(-1)?.current).toBe("calls");
    expect(view.statuses.at(-1)).toBe("Could not read bridge calls: permission_denied.");
    expect(ANSWERS["plugin.stats"].windowSeconds).toBe(60);
  });
});
