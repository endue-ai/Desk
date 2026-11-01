import { describe, expect, it } from "vitest";
import { denied, ENV, missing, mount, scope } from "./harness";

const PTY = { cols: 80, rows: 24 };

describe("starting a terminal", () => {
  it("runs the platform's shell in a PTY of the view's size and opens a desk buffer for it", async () => {
    const { view, params, ran, host } = await mount({ size: { cols: 120, rows: 40 } });
    expect(params("proc.spawn")).toEqual([
      {
        command: "zsh",
        args: ["-l"],
        cwd: "~",
        env: ENV,
        pty: { cols: 120, rows: 40 },
        scope: scope("zsh"),
      },
    ]);
    expect(view.opened).toEqual([{ id: "t-1", title: "zsh" }]);
    expect(view.shown).toEqual(["t-1"]);
    expect(ran("desk.buffers.open")).toEqual([{ name: "zsh" }]);
    expect(host.state).toMatchObject({
      next: 1,
      shown: "t-1",
      sessions: [{ id: "t-1", title: "zsh", procId: "p1", buffer: "endue.terminal:1" }],
    });
  });

  it("a shell that is not there gives way to the next, and the tab takes its name", async () => {
    let spawns = 0;
    const { view, params, ran } = await mount({
      platform: "linux",
      handlers: {
        "proc.spawn": ({ command }) => {
          spawns += 1;
          if (command === "bash") throw missing("bash");
          return { procId: `p${spawns}`, pid: spawns };
        },
      },
    });
    expect(params("proc.spawn").map((p) => (p as { command: string }).command)).toEqual([
      "bash",
      "zsh",
    ]);
    expect(params("proc.spawn")[1]).toMatchObject({ args: [] });
    expect(view.opened).toEqual([{ id: "t-1", title: "bash" }]);
    expect(view.titles).toEqual([{ id: "t-1", title: "zsh" }]);
    expect(ran("desk.buffers.update")).toEqual([{ id: "endue.terminal:1", name: "zsh" }]);
  });

  it("on Windows the shells are pwsh, powershell and cmd", async () => {
    const { params } = await mount({
      platform: "windows",
      handlers: {
        "proc.spawn": ({ command }) => {
          if (command !== "cmd") throw missing(command);
          return { procId: "p1" };
        },
      },
    });
    expect(params("proc.spawn")).toMatchObject([
      { command: "pwsh", args: ["-NoLogo"] },
      { command: "powershell", args: ["-NoLogo"] },
      { command: "cmd", args: [] },
    ]);
  });

  it("the settings from init.get choose the shell, its arguments, the folder and the environment", async () => {
    const { params } = await mount({
      settings: {
        "endue.terminal.shell": "fish",
        "endue.terminal.login": "no",
        "endue.terminal.args": ["-i"],
        "endue.terminal.cwd": "~/Projects",
        "endue.terminal.env": { EDITOR: "vim" },
      },
    });
    expect(params("proc.spawn")).toEqual([
      {
        command: "fish",
        args: ["-i"],
        cwd: "~/Projects",
        env: { ...ENV, EDITOR: "vim" },
        pty: PTY,
        scope: scope("fish"),
      },
    ]);
  });

  it("a shell outside the grants is asked for once, then tried again", async () => {
    let spawns = 0;
    const { params, view } = await mount({
      settings: { "endue.terminal.shell": "/opt/homebrew/bin/fish" },
      handlers: {
        "proc.spawn": () => {
          spawns += 1;
          if (spawns === 1) throw denied("proc:spawn over fish");
          return { procId: "p1" };
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-10-31T09:00:00Z",
          },
        }),
      },
    });
    expect(params("perm.request")).toEqual([
      {
        permission: scope("/opt/homebrew/bin/fish"),
        reason: "To run /opt/homebrew/bin/fish in a terminal",
      },
    ]);
    expect(params("proc.spawn")).toHaveLength(2);
    expect(view.opened).toEqual([{ id: "t-1", title: "fish" }]);
    expect(view.lines).toEqual([]);
  });

  it("a refusal is said in the terminal and on the status line, and nothing runs", async () => {
    const { params, view, app } = await mount({
      settings: { "endue.terminal.shell": "fish" },
      handlers: {
        "proc.spawn": () => {
          throw denied("proc:spawn over fish");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    expect(params("proc.spawn")).toHaveLength(1);
    expect(view.lines).toEqual([{ id: "t-1", text: "Not allowed to run fish." }]);
    expect(view.statuses.at(-1)).toBe("Not allowed to run fish.");
    expect(app.sessions()[0]).toMatchObject({ procId: null, exit: "Not allowed to run fish." });
  });

  it("another failure is said with its code, with no ask", async () => {
    const { params, view } = await mount({
      handlers: {
        "proc.spawn": () => {
          throw missing("zsh");
        },
        "perm.request": () => ({ granted: true }),
      },
    });
    expect(params("perm.request")).toEqual([]);
    expect(params("proc.spawn")).toHaveLength(3);
    expect(view.lines).toEqual([{ id: "t-1", text: "Could not start sh: not_found." }]);
  });
});

describe("a running terminal", () => {
  it("shows its process's output, decoded, and only its own", async () => {
    const { host, view, settle } = await mount();
    host.emit({
      event: "proc.output",
      data: { procId: "p1", stream: "pty", data: "hi\r\n", encoding: "utf8" },
    });
    host.emit({
      event: "proc.output",
      data: { procId: "p1", stream: "pty", data: "/wA=", encoding: "base64" },
    });
    host.emit({
      event: "proc.output",
      data: { procId: "p9", stream: "pty", data: "stranger", encoding: "utf8" },
    });
    await settle();
    expect(view.writes).toEqual([
      { id: "t-1", data: "hi\r\n" },
      { id: "t-1", data: Uint8Array.from([255, 0]) },
    ]);
    expect(host.state).toMatchObject({
      sessions: [
        {
          tail: [
            { data: "hi\r\n", encoding: "utf8" },
            { data: "/wA=", encoding: "base64" },
          ],
        },
      ],
    });
  });

  it("typing, resizing and interrupting reach the process under the shell's scope", async () => {
    const { app, host, params, settle } = await mount();
    app.input("t-1", "ls\r");
    app.resize("t-1", 100, 30);
    await host.command("endue.terminal.interrupt");
    await settle();
    expect(params("proc.write")).toEqual([
      { procId: "p1", data: "ls\r", encoding: "utf8", scope: scope("zsh") },
    ]);
    expect(params("proc.resize")).toEqual([
      { procId: "p1", size: { cols: 100, rows: 30 }, scope: scope("zsh") },
    ]);
    expect(params("proc.kill")).toEqual([{ procId: "p1", signal: "int", scope: scope("zsh") }]);
  });

  it("an exit is said in the terminal, and Enter starts the shell again", async () => {
    const { app, host, view, params, settle } = await mount();
    host.emit({ event: "proc.exit", data: { procId: "p1", code: 1 } });
    await settle();
    expect(view.lines).toEqual([
      { id: "t-1", text: "zsh exited with code 1. Press Enter to start it again." },
    ]);
    app.input("t-1", "x");
    app.input("t-1", "\r");
    await settle();
    expect(params("proc.write")).toEqual([]);
    expect(params("proc.spawn")).toHaveLength(2);
    expect(view.lines.at(-1)).toEqual({ id: "t-1", text: "Starting zsh again." });
    host.emit({
      event: "proc.output",
      data: { procId: "p2", stream: "pty", data: "back", encoding: "utf8" },
    });
    await settle();
    expect(view.writes).toEqual([{ id: "t-1", data: "back" }]);
  });

  it("restart ends a running shell with term and starts it again after the exit", async () => {
    const { host, params, settle } = await mount();
    await host.command("endue.terminal.restart");
    expect(params("proc.kill")).toEqual([{ procId: "p1", signal: "term", scope: scope("zsh") }]);
    expect(params("proc.spawn")).toHaveLength(1);
    host.emit({ event: "proc.exit", data: { procId: "p1", signal: "term" } });
    await settle();
    expect(params("proc.spawn")).toHaveLength(2);
  });

  it("the bell notifies unless the setting says none, and a title renames the buffer", async () => {
    const { app, params, ran, view, settle } = await mount();
    app.bell("t-1");
    app.retitle("t-1", "vim");
    app.retitle("t-1", "vim");
    await settle();
    expect(params("ui.notify")).toEqual([
      {
        title: "Terminal",
        body: "zsh rang the bell.",
        level: "info",
        scope: { permission: "ui:notify" },
      },
    ]);
    expect(view.titles).toEqual([{ id: "t-1", title: "vim" }]);
    expect(ran("desk.buffers.update")).toEqual([{ id: "endue.terminal:1", name: "vim" }]);

    const quiet = await mount({ settings: { "endue.terminal.bell": "none" } });
    quiet.app.bell("t-1");
    await quiet.settle();
    expect(quiet.params("ui.notify")).toEqual([]);
  });
});

describe("several terminals", () => {
  it("new, next, previous and close move between tabs; a close hangs the shell up", async () => {
    const { host, view, params, ran, settle } = await mount();
    expect(await host.command("endue.terminal.new")).toBe("t-2");
    expect(view.shown).toEqual(["t-1", "t-2"]);
    expect(view.focused).toEqual(["t-2"]);
    expect(await host.command("endue.terminal.previous")).toBe("t-1");
    expect(await host.command("endue.terminal.next")).toBe("t-2");
    expect(await host.command("endue.terminal.next")).toBe("t-1");

    await host.command("endue.terminal.close", { session: "t-2" });
    await settle();
    expect(params("proc.kill")).toEqual([{ procId: "p2", signal: "hup", scope: scope("zsh") }]);
    expect(view.closed).toEqual(["t-2"]);
    expect(ran("desk.buffers.close")).toEqual([{ id: "endue.terminal:2" }]);
    expect(host.state).toMatchObject({ shown: "t-1", sessions: [{ id: "t-1" }] });
  });

  it("the desk's buffer requests switch to a terminal and forget a closed one", async () => {
    const { host, view, params, settle } = await mount();
    await host.command("endue.terminal.new");
    await host.command("desk.buffers.show", { buffer: "endue.terminal:1" });
    expect(view.shown.at(-1)).toBe("t-1");
    expect(view.focused.at(-1)).toBe("t-1");

    await host.command("desk.buffers.closed", { buffer: "endue.terminal:2" });
    await host.command("desk.buffers.closed", { buffer: "endue.notes:9" });
    await settle();
    expect(view.closed).toEqual(["t-2"]);
    expect(params("proc.kill")).toEqual([{ procId: "p2", signal: "hup", scope: scope("zsh") }]);
  });

  it("closing the last terminal leaves none, and focus opens one again", async () => {
    const { host, view, settle } = await mount();
    await host.command("endue.terminal.close");
    await settle();
    expect(view.statuses.at(-1)).toBe("No terminal is open.");
    await expect(host.command("endue.terminal.close")).rejects.toThrow("No terminal is open.");
    expect(await host.command("endue.terminal.focus")).toBe("t-2");
    expect(view.opened.at(-1)).toEqual({ id: "t-2", title: "zsh" });
  });
});

describe("endue.terminal.run", () => {
  it("runs a program of its own in a new terminal and answers its ids", async () => {
    const { host, params, view } = await mount();
    const answer = await host.command("endue.terminal.run", {
      command: "git",
      args: ["status"],
      cwd: "~/Projects",
    });
    expect(answer).toEqual({ session: "t-2", procId: "p2" });
    expect(params("proc.spawn")[1]).toEqual({
      command: "git",
      args: ["status"],
      cwd: "~/Projects",
      env: ENV,
      pty: PTY,
      scope: scope("git"),
    });
    expect(view.opened.at(-1)).toEqual({ id: "t-2", title: "git" });
  });

  it("refuses a shell with arguments, a missing program and one that will not start", async () => {
    const { host, params } = await mount({
      handlers: {
        "proc.spawn": ({ command }) => {
          if (command === "nope") throw missing("nope");
          return { procId: "p1" };
        },
      },
    });
    await expect(
      host.command("endue.terminal.run", { command: "zsh", args: ["-c", "rm -rf ~"] }),
    ).rejects.toThrow("zsh is a shell: run the program itself");
    await expect(host.command("endue.terminal.run", { command: "git status" })).rejects.toThrow(
      "without arguments",
    );
    await expect(host.command("endue.terminal.run", {})).rejects.toThrow("Say which program");
    expect(params("proc.spawn")).toHaveLength(1);
    await expect(host.command("endue.terminal.run", { command: "nope" })).rejects.toThrow(
      "Could not start nope: not_found.",
    );
  });
});

describe("after a reload", () => {
  it("comes back to its terminals without starting them again", async () => {
    const first = await mount();
    first.host.emit({
      event: "proc.output",
      data: { procId: "p1", stream: "pty", data: "kept", encoding: "utf8" },
    });
    await first.host.command("endue.terminal.new");
    first.host.emit({ event: "proc.exit", data: { procId: "p2", code: 0 } });
    await first.settle();

    const again = await mount({ state: first.host.state, size: { cols: 90, rows: 20 } });
    expect(again.params("proc.spawn")).toEqual([]);
    expect(again.view.opened).toEqual([
      { id: "t-1", title: "zsh" },
      { id: "t-2", title: "zsh" },
    ]);
    expect(again.view.writes).toEqual([{ id: "t-1", data: "kept" }]);
    expect(again.view.lines).toEqual([
      { id: "t-2", text: "zsh exited with code 0. Press Enter to start it again." },
    ]);
    expect(again.params("proc.resize")).toEqual([
      { procId: "p1", size: { cols: 90, rows: 20 }, scope: scope("zsh") },
    ]);
    expect(again.view.shown).toEqual(["t-2"]);
    expect(await again.host.command("endue.terminal.new")).toBe("t-3");
  });
});
