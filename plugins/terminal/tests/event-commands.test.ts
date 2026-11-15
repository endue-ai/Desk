// A terminal's events run desk commands (#319), as Emacs's ring-bell-function does: the bell, a
// program's notification (OSC 9, 777, 99), a long command finishing (OSC 133 / 633) and a program
// ending each run the command `endue.terminal.event-commands` names for them, with what happened as
// its args, whether or not anyone looks and whatever the notification settings say. A flood is held
// back as notices are; a command outside the plugin's cmd:invoke grant is asked for once.
import { describe, expect, it } from "vitest";
import { createHooks, EVENTS } from "../ui/hooks.js";
import { DEFAULTS, parseSettings } from "../ui/shell.js";
import { mount, notifications } from "./harness";

const EVENT_COMMANDS = "endue.terminal.event-commands";

/** Commands of a desk plugin that hears the terminal, recording what each was run with. */
function hearing() {
  const runs: Array<{ id: string; args: unknown }> = [];
  const record = (id: string) => (args: unknown) => {
    runs.push({ id, args });
    return null;
  };
  const commands = Object.fromEntries(
    ["example.ring", "example.note", "example.done", "example.ended"].map((id) => [id, record(id)]),
  );
  return { runs, commands };
}

async function terminal(settings: Record<string, unknown> = {}, looking = () => false) {
  const clock = { now: 1_000_000 };
  const { runs, commands } = hearing();
  const mounted = await mount({
    handlers: notifications(),
    commands,
    looking,
    now: () => clock.now,
    settings: {
      [EVENT_COMMANDS]: {
        bell: "example.ring",
        notification: "example.note",
        command: "example.done",
        exit: "example.ended",
      },
      ...settings,
    },
  });
  return { ...mounted, runs, clock };
}

describe("the terminal's events", () => {
  it("are the bell, a notification, a command and an exit", () => {
    expect(EVENTS).toEqual(["bell", "notification", "command", "exit"]);
    expect(DEFAULTS.eventCommands).toEqual({});
  });

  it("each run the command the setting names, with what happened", async () => {
    const { app, host, runs, clock, settle } = await terminal();
    app.bell("t-1");
    app.osc("t-1", 777, "notify;Claude Code;Waiting for your input");
    app.osc("t-1", 633, "E;make build");
    app.osc("t-1", 133, "C");
    clock.now += 42_000;
    app.osc("t-1", 133, "D;2");
    host.emit({ event: "proc.exit", data: { procId: "p1", code: 1 } });
    await settle();
    const base = { session: "t-1", tab: "zsh", looking: false };
    expect(runs).toEqual([
      { id: "example.ring", args: { event: "bell", ...base, level: "info" } },
      {
        id: "example.note",
        args: {
          event: "notification",
          ...base,
          level: "info",
          title: "Claude Code",
          body: "Waiting for your input",
        },
      },
      {
        id: "example.done",
        args: {
          event: "command",
          ...base,
          level: "warning",
          commandLine: "make build",
          exit: 2,
          seconds: 42,
        },
      },
      { id: "example.ended", args: { event: "exit", ...base, level: "warning", code: 1 } },
    ]);
  });

  it("run while the person looks and whatever the notification settings say", async () => {
    const { app, runs, params, settle } = await terminal(
      { "endue.terminal.bell": "none", "endue.terminal.program-notify": false },
      () => true,
    );
    app.bell("t-1");
    app.osc("t-1", 9, "Build finished");
    await settle();
    expect(params("ui.notify")).toEqual([]);
    expect(runs.map(({ id, args }) => [id, (args as { looking: boolean }).looking])).toEqual([
      ["example.ring", true],
      ["example.note", true],
    ]);
  });

  it("hold a flood back and the next run says how many it held", async () => {
    const { app, runs, clock, settle } = await terminal();
    for (let i = 0; i < 50; i++) app.bell("t-1");
    await settle();
    expect(runs).toHaveLength(5);
    clock.now += 60_000;
    app.bell("t-1");
    await settle();
    expect(runs).toHaveLength(6);
    expect(runs.at(-1)?.args).toMatchObject({ event: "bell", held: 45 });
  });

  it("leave out a short command, and run nothing for an event the setting does not name", async () => {
    const { app, runs, clock, settle } = await terminal({
      [EVENT_COMMANDS]: { bell: "example.ring" },
    });
    app.osc("t-1", 133, "C");
    clock.now += 2_000;
    app.osc("t-1", 133, "D;0");
    app.osc("t-1", 9, "Build finished");
    await settle();
    expect(runs).toEqual([]);
  });

  it("are read from the setting: known events, command ids only", () => {
    expect(
      parseSettings({
        [EVENT_COMMANDS]: {
          bell: "endue.terminal.focus",
          exit: "Not An Id",
          command: 5,
          wink: "example.wink",
        },
      }).eventCommands,
    ).toEqual({ bell: "endue.terminal.focus" });
    expect(parseSettings({ [EVENT_COMMANDS]: ["example.ring"] }).eventCommands).toEqual({});
  });
});

describe("a command outside the plugin's grant", () => {
  /** createHooks with a grant the person gives (or not) when asked. */
  function hooks(answer: boolean, fails = "", revoked = false) {
    let granted = false;
    const runs: Array<[string, unknown]> = [];
    const requests: unknown[] = [];
    const said: string[] = [];
    const deny = (code: string) => Object.assign(new Error(code), { code });
    const made = createHooks({
      commands: {
        run: async (id: string, args: unknown) => {
          if (!granted || revoked) throw deny("permission_denied");
          if (fails) throw deny(fails);
          runs.push([id, args]);
        },
      },
      bridge: {
        call: async (method: string, params: unknown) => {
          requests.push({ method, params });
          granted = answer;
          return { granted: answer };
        },
      },
      settings: () => ({ ...DEFAULTS, eventCommands: { bell: "example.ring" } }),
      title: () => "zsh",
      looking: () => false,
      now: () => 0,
      say: (text: string) => said.push(text),
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { made, runs, requests, said, settle };
  }

  it("is asked for once, and runs once the person allows it", async () => {
    const { made, runs, requests, settle } = hooks(true);
    made.fire("t-1", "bell");
    made.fire("t-1", "bell");
    await settle();
    expect(requests).toEqual([
      {
        method: "perm.request",
        params: {
          permission: { permission: "cmd:invoke", ids: ["example.ring"] },
          reason: "To run example.ring when a terminal rings the bell",
        },
      },
    ]);
    expect(runs.map(([id]) => id)).toEqual(["example.ring", "example.ring"]);
  });

  it("is not asked for again once refused, and the refusal is said once", async () => {
    const { made, runs, requests, said, settle } = hooks(false);
    made.fire("t-1", "bell");
    await settle();
    made.fire("t-1", "bell");
    await settle();
    expect(requests).toHaveLength(1);
    expect(runs).toEqual([]);
    expect(said).toEqual(["Not allowed to run example.ring for the terminal's bell."]);
  });

  it("is asked for again when a grant no longer holds (once, or taken back)", async () => {
    const { made, runs, requests, said, settle } = hooks(true, "", true);
    made.fire("t-1", "bell");
    await settle();
    made.fire("t-1", "bell");
    await settle();
    expect(requests).toHaveLength(2);
    expect(runs).toEqual([]);
    expect(said).toEqual([
      "Could not run example.ring for the terminal's bell: permission_denied.",
    ]);
  });

  it("says a failure once", async () => {
    const { made, said, settle } = hooks(true, "failed");
    made.fire("t-1", "bell");
    await settle();
    made.fire("t-1", "bell");
    await settle();
    expect(said).toEqual(["Could not run example.ring for the terminal's bell: failed."]);
  });
});
