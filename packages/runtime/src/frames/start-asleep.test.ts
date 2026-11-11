// Plugins that start asleep (#590, ADR 0070): the host mounts them without a surface, registers
// their manifest commands, and opens the surface on first use. Frames are played by the test.
import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { PluginHost } from "../plugins";
import { startsAsleep } from "./start-asleep";

type Placement = "center" | "floating" | "left" | "right" | "bottom" | "overlay";

/** A ready, enabled UI plugin with one surface, and a command of its own. */
function plugin(id: string, placement: Placement = "center", more: object = {}): PluginInfo {
  return {
    id,
    status: "ready",
    enabled: true,
    builtIn: false,
    revision: 1,
    manifest: {
      id,
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: id, placement }],
      contributes: { commands: [{ id: `${id}.hello`, title: "Hello" }] },
      ...more,
    },
  } as PluginInfo;
}

type Posted = { type: string; name?: string; call?: number; event?: BridgeEvent };

/** A host whose `asleep` plugins start asleep, over frames that record what they are sent. */
async function host(plugins: PluginInfo[], asleep: string[]) {
  const registered: Array<{ id: string; caller: string | undefined }> = [];
  const stub = browserStub({
    "plugin.list": () => ({ plugins }),
    "cmd.register": (params, caller) => {
      registered.push({ id: params.id, caller });
      return {};
    },
  });
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const frames = new Map<string, Window & { posted: Posted[] }>();
  const opened: string[] = [];
  const open = vi.fn((spec: { id: string }) => {
    opened.push(spec.id);
    const posted: Posted[] = [];
    frames.set(spec.id, {
      posted,
      postMessage: (m: Posted) => posted.push(m),
    } as unknown as Window & { posted: Posted[] });
  });
  const close = vi.fn();
  const show = vi.fn();
  const plugins_ = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open,
      close,
      reload() {},
      show,
      frame: (id) => frames.get(id) ?? null,
      wake: () => false,
      startAsleep: async () => new Set(asleep),
    },
    { url: () => "about:blank" },
  );
  await plugins_.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** The frame of `id` says hello, as the SDK does once its page loaded. */
  const hello = (id: string) =>
    receive({ source: frames.get(id), data: { type: "desk:hello" } } as unknown as MessageEvent);
  const reply = (id: string, call: number | undefined, result: unknown) =>
    receive({
      source: frames.get(id),
      data: { type: "desk:reply", call, ok: true, result },
    } as unknown as MessageEvent);
  const posted = (id: string) => frames.get(id)?.posted ?? [];
  return { stub, host: plugins_, opened, close, show, registered, hello, reply, posted };
}

describe("a plugin that starts asleep (#590)", () => {
  it("a plugin the host starts asleep does not mount: no surface opens, its manifest commands are registered and asleep() says so", async () => {
    const {
      host: plugins,
      opened,
      registered,
    } = await host([plugin("test.asleep"), plugin("test.awake")], ["test.asleep"]);
    expect(opened).toEqual(["test.awake"]);
    expect(plugins.mounted()).toEqual(["test.asleep", "test.awake"]);
    expect(plugins.asleep("test.asleep")).toBe(true);
    expect(plugins.asleep("test.awake")).toBe(false);
    expect(registered).toContainEqual({ id: "test.asleep.hello", caller: "test.asleep" });
    plugins.stop();
  });

  it("a command invocation wakes it: its surface opens and the invocation reaches the frame after its hello", async () => {
    const {
      stub,
      host: plugins,
      opened,
      hello,
      posted,
    } = await host([plugin("test.asleep")], ["test.asleep"]);
    const invoked = {
      event: "cmd.invoked",
      data: { invocationId: "i-1", id: "test.asleep.hello", caller: "desk" },
    } as unknown as BridgeEvent;
    stub.emit(invoked);
    expect(opened).toEqual(["test.asleep"]);
    // It still sleeps until its frame says hello: what needs its answer waits for that.
    expect(plugins.asleep("test.asleep")).toBe(true);
    expect(posted("test.asleep")).toEqual([]);

    hello("test.asleep");
    expect(plugins.asleep("test.asleep")).toBe(false);
    const types = posted("test.asleep").map((m) => m.event?.event ?? m.type);
    expect(types).toEqual(["desk:init", "cmd.invoked"]);
    // Woken once: a second invocation goes straight to the frame.
    stub.emit(invoked);
    expect(opened).toEqual(["test.asleep"]);
    plugins.stop();
  });

  it("a request (a palette provider, desk.files.visit) and a launch wake it too, and unmounting one that never woke closes nothing", async () => {
    const {
      host: plugins,
      opened,
      close,
      show,
      hello,
      reply,
      posted,
    } = await host(
      [plugin("test.notes"), plugin("test.git"), plugin("test.mail")],
      ["test.notes", "test.git", "test.mail"],
    );
    const visit = plugins.request("test.notes", "desk.files.visit", { path: "~/a.md" });
    expect(opened).toEqual(["test.notes"]);
    hello("test.notes");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const asked = posted("test.notes").find((m) => m.name === "desk.files.visit");
    expect(asked?.type).toBe("desk:command");
    reply("test.notes", asked?.call, { ok: true });
    await expect(visit).resolves.toEqual({ ok: true });

    await plugins.launch("test.git");
    expect(opened).toEqual(["test.notes", "test.git"]);
    expect(show).toHaveBeenCalledWith("test.git", true);

    // The shell wakes what its layout places; waking one that is awake does nothing.
    plugins.wake("test.notes");
    expect(opened).toEqual(["test.notes", "test.git"]);

    plugins.unmount("test.mail");
    expect(close).not.toHaveBeenCalled();
    expect(plugins.mounted()).not.toContain("test.mail");
    plugins.unmount("test.git");
    expect(close).toHaveBeenCalledWith("test.git");
    plugins.stop();
  });

  it("turning it on again, as desk.display.show does for a plugin with no surface, opens its surface", async () => {
    const { stub, host: plugins, opened } = await host([plugin("test.notes")], ["test.notes"]);
    stub.emit({
      event: "plugin.changed",
      data: { plugin: "test.notes", change: "enabled", revision: 1 },
    } as BridgeEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened).toEqual(["test.notes"]);
    plugins.stop();
  });
});

describe("startsAsleep", () => {
  it("startsAsleep: with a saved session, only enabled UI plugins that are not autoload, whose surface is a window and that the session does not show; without one, none", () => {
    const off = { ...plugin("p.off"), enabled: false };
    const policy = { ...plugin("p.policy"), manifest: { id: "p.policy", kind: "policy" } };
    const bare = plugin("p.bare");
    delete bare.manifest?.surfaces;
    const plugins = [
      plugin("p.window"),
      plugin("p.floating", "floating"),
      bare,
      plugin("p.shown"),
      plugin("p.file"),
      plugin("p.auto", "center", { autoload: true }),
      plugin("p.left", "left"),
      plugin("p.right", "right"),
      plugin("p.dock", "bottom"),
      plugin("p.palette", "overlay"),
      off,
      policy,
    ] as PluginInfo[];
    const shown = new Set(["p.shown", "p.file"]);
    expect([...startsAsleep(plugins, shown)].sort()).toEqual(["p.bare", "p.floating", "p.window"]);
    expect([...startsAsleep(plugins, undefined)]).toEqual([]);
  });

  it("on a desk whose window host holds the side surfaces too, a side window the session does not show starts asleep: one the person closed stays closed (issue 163, finding 3)", () => {
    const plugins = [
      plugin("p.window"),
      plugin("p.shown"),
      plugin("p.left", "left"),
      plugin("p.right", "right"),
      plugin("p.side", "right"),
      plugin("p.dock", "bottom"),
      plugin("p.palette", "overlay"),
    ] as PluginInfo[];
    const shown = new Set(["p.shown", "p.side"]);
    expect([...startsAsleep(plugins, shown, { windows: true })].sort()).toEqual([
      "p.left",
      "p.right",
      "p.window",
    ]);
    expect([...startsAsleep(plugins, shown, { windows: false })]).toEqual(["p.window"]);
    expect([...startsAsleep(plugins, undefined, { windows: true })]).toEqual([]);
  });
});
