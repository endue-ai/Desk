// Every notification a terminal program sends reaches the desk (#538, ADR 0113): OSC 9, 777 and 99,
// the bell from a tab nobody looks at, a long command finishing and a program ending with an error,
// each one ui.notify titled with the tab, rate limited and de-duplicated, with an unread badge on
// the tab, and the desk's click (desk.notify.open) showing and focusing that tab.
import { describe, expect, it } from "vitest";
import { mount, notifications } from "./harness";

const NOTIFY = { permission: "ui:notify" } as const;
const note = (title: string, body: string, level = "info") => ({
  title,
  body,
  level,
  scope: NOTIFY,
});

/** Two tabs, the second one on screen and looked at; a clock the test moves. */
async function twoTabs(options: { settings?: Record<string, unknown> } = {}) {
  const clock = { now: 1_000_000 };
  let looked: string | null = null;
  const mounted = await mount({
    handlers: notifications(),
    looking: (id) => id === looked,
    now: () => clock.now,
    ...options,
  });
  await mounted.host.command("endue.terminal.new");
  looked = "t-2";
  mounted.view.badges.length = 0;
  return { ...mounted, clock, look: (id: string | null) => (looked = id) };
}

describe("programs' notifications", () => {
  it("OSC 9, 777 and 99 each become one ui.notify titled with the tab", async () => {
    const { app, params, settle } = await mount({ handlers: notifications() });
    app.osc("t-1", 9, "Build finished");
    app.osc("t-1", 777, "notify;Claude Code;Waiting for your input");
    app.osc("t-1", 99, "i=1:d=0;Deploy");
    app.osc("t-1", 99, "i=1:p=body;Done in 3 s");
    app.osc("t-1", 99, `e=1:p=title;${btoa("Tests")}`);
    await settle();
    expect(params("ui.notify")).toEqual([
      note("zsh", "Build finished"),
      note("zsh — Claude Code", "Waiting for your input"),
      note("zsh — Deploy", "Done in 3 s"),
      note("zsh — Tests", ""),
    ]);
  });

  it("leaves out what is not a notification and keeps a body to 300 characters", async () => {
    const { app, params, settle } = await mount({ handlers: notifications() });
    app.osc("t-1", 9, "4;1;50");
    app.osc("t-1", 9, "9;/Users/me/src");
    app.osc("t-1", 777, "preexec");
    app.osc("t-1", 99, "i=2:p=?;");
    app.osc("t-1", 9, `\x1b[31m${"x".repeat(400)}`);
    await settle();
    const sent = params("ui.notify") as Array<{ body: string }>;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toHaveLength(300);
    expect(sent[0]?.body.endsWith("…")).toBe(true);
    expect(sent[0]?.body.startsWith("[31m")).toBe(false);
  });

  it("the bell from a hidden tab is one notification; on the tab in view it flashes", async () => {
    const { app, params, view, settle } = await twoTabs();
    app.bell("t-1");
    app.bell("t-2");
    await settle();
    expect(params("ui.notify")).toEqual([note("zsh", "The program rang the bell.")]);
    expect(view.flashes).toEqual(["t-2"]);
    expect(view.badges).toEqual([{ id: "t-1", count: 1 }]);
  });

  it("a flood is rate limited and the same message is said once", async () => {
    const { app, params, settle, clock } = await twoTabs();
    for (let i = 0; i < 50; i++) app.osc("t-1", 9, `line ${i}`);
    for (let i = 0; i < 20; i++) app.bell("t-1");
    await settle();
    expect(params("ui.notify")).toHaveLength(5);
    clock.now += 60_000;
    app.osc("t-1", 9, "line 0");
    app.osc("t-1", 9, "line 0");
    await settle();
    const sent = params("ui.notify") as Array<{ body: string }>;
    expect(sent).toHaveLength(6);
    expect(sent[5]?.body).toBe("line 0 (and 46 more held back)");
  });

  it("the desk's click shows and focuses the tab that sent it and clears its badge", async () => {
    const { app, host, view, settle } = await twoTabs();
    app.osc("t-1", 777, "notify;make;done");
    await settle();
    expect(view.badges.at(-1)).toEqual({ id: "t-1", count: 1 });
    await host.command("desk.notify.open", { notificationId: "n1" });
    expect(view.shown.at(-1)).toBe("t-1");
    expect(view.focused.at(-1)).toBe("t-1");
    expect(view.badges.at(-1)).toEqual({ id: "t-1", count: 0 });
    expect(await host.command("desk.notify.open", { notificationId: "unknown" })).toBeNull();
  });
});

describe("the terminal's own notices", () => {
  it("a long command on a hidden tab says it finished, and how", async () => {
    const { app, params, settle, clock, look } = await twoTabs();
    app.osc("t-1", 133, "C");
    clock.now += 12_000;
    app.osc("t-1", 133, "D;0");
    app.osc("t-1", 633, "E;make build\\x3b make test");
    app.osc("t-1", 633, "C");
    clock.now += 75_000;
    app.osc("t-1", 633, "D;2");
    app.osc("t-1", 133, "C");
    clock.now += 3_000;
    app.osc("t-1", 133, "D;0");
    app.show("t-1");
    look("t-1");
    app.osc("t-1", 133, "C");
    clock.now += 30_000;
    app.osc("t-1", 133, "D;0");
    await settle();
    expect(params("ui.notify")).toEqual([
      note("zsh", "A command finished after 12 s.", "success"),
      note("zsh", "make build; make test failed with exit code 2 after 1 min 15 s.", "warning"),
    ]);
  });

  it("the threshold is a setting, and 0 turns the notices off", async () => {
    const { app, params, settle, clock } = await twoTabs({
      settings: { "endue.terminal.notify-after": 0 },
    });
    app.osc("t-1", 133, "C");
    clock.now += 600_000;
    app.osc("t-1", 133, "D;0");
    await settle();
    expect(params("ui.notify")).toEqual([]);
  });

  it("a program ending with an error out of sight says so; a clean exit does not", async () => {
    const { host, params, view, settle } = await twoTabs();
    host.emit({ event: "proc.exit", data: { procId: "p1", code: 1 } });
    host.emit({ event: "proc.exit", data: { procId: "p2", code: 0 } });
    await settle();
    expect(params("ui.notify")).toEqual([note("zsh", "Exited with code 1.", "warning")]);
    expect(view.ended).toEqual([
      { id: "t-1", text: "zsh exited with code 1." },
      { id: "t-2", text: "zsh exited with code 0." },
    ]);
  });
});
