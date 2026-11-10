// @vitest-environment jsdom
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { renderTree as e2eRenderTree } from "../../e2e/render-tree";
import { browserCore } from "../bridge/core";
import { Buffers } from "../buffers";
import { ManualClock } from "../clock";
import { Edges } from "../edges";
import { PolicyHub } from "../hub";
import { ShortcutRouter } from "../input";
import type { DeskContext } from "../policies/context";
import { SurfaceHost } from "../surfaces";
import { type InspectDeps, installInspect } from "./install";

const policy = (id: string, settings: NonNullable<PluginManifest["contributes"]>["settings"]) => ({
  id,
  name: id.split(".")[1],
  version: "0.1.0",
  kind: "policy" as const,
  contributes: { settings },
});
const ui = (id: string, name: string): PluginManifest => ({
  id,
  name,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
});
const MANIFESTS: PluginManifest[] = [
  policy("desk.theme", {
    "desk.theme.scheme": { kind: "string", default: "dark", choices: ["system", "light", "dark"] },
    "desk.theme.contrast": { kind: "string", default: "normal" },
  }),
  policy("desk.notify", { "desk.notify.seconds": { kind: "integer", default: 4 } }),
  ui("desk.inspector", "Inspector"),
  ui("endue.notes", "Notes"),
  ui("endue.terminal", "Terminal"),
  ui("desk.palette", "Palette"),
];
const MANAGE = { permission: "perm:manage" } as const;
const INSPECT = "desk.inspect.open";

/** The runtime's inspect command on the stub core, over a desk with surfaces, views and buffers. */
async function desk(frames?: InspectDeps["frames"]) {
  const core = browserCore({
    manifests: MANIFESTS,
    init: { settings: { "desk.theme.scheme": "light", "desk.notify.seconds": "long" } },
  });
  const bridge = core.client;
  // perm:manage last: once a caller holds it, the next requests wait for its answer.
  const grants: Record<string, Array<{ permission: string; ids?: string[] }>> = {
    "example.agent": [{ permission: "cmd:invoke", ids: [INSPECT] }],
    cli: [{ permission: "cmd:invoke", ids: ["*"] }, MANAGE],
  };
  for (const [caller, permissions] of Object.entries(grants))
    for (const permission of permissions)
      await bridge.call(
        "perm.request",
        { permission: permission as never, reason: "test" },
        { caller },
      );
  const hub = new PolicyHub(bridge);
  const root = document.createElement("div");
  root.id = "desk";
  document.body.append(root);
  const compositor = document.createElement("main");
  compositor.className = "desk-surfaces";
  const status = document.createElement("footer");
  status.className = "desk-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "desk ready";
  root.append(compositor, status);
  const surfaces = new SurfaceHost(compositor, () => {}, new Edges(compositor));
  const shortcuts = new ShortcutRouter({ platform: "mac" });
  const ctx = {
    hub,
    root,
    win: window,
    clock: new ManualClock(),
    bridge,
    shortcuts,
    surfaces,
  } as unknown as DeskContext;
  const buffers = new Buffers();
  const launched: unknown[] = [];
  hub.commands.define("desk.plugins.open", {
    title: "Open a plugin",
    owner: "desk",
    run: (args) => void launched.push(args),
  });
  installInspect(ctx, {
    buffers,
    views: { ids: () => ["calendar"], title: () => "Calendar", focused: () => null },
    ...(frames ? { frames } : {}),
  });
  await hub.readInit(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: { permission: "plugin:manage" } })).plugins);
  await hub.commands.settled();
  return { core, hub, root, surfaces, shortcuts, buffers, launched };
}

/** Invoke the command as `caller` and wait for its answer. */
async function ask(core: Awaited<ReturnType<typeof desk>>["core"], caller: string, args: object) {
  const { invocationId } = await core.client.call(
    "cmd.invoke",
    { id: INSPECT, args: args as never, scope: { permission: "cmd:invoke", ids: [INSPECT] } },
    { caller },
  );
  return new Promise<unknown>((resolve, reject) => {
    const off = core.client.onEvent((event) => {
      if (event.event !== "cmd.answered" || event.data.invocationId !== invocationId) return;
      off();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error?.message));
    });
  });
}

type Node = { tag: string; children?: Node[]; [field: string]: unknown };
const find = (node: Node, test: (n: Node) => boolean): Node | undefined =>
  test(node) ? node : node.children?.map((c) => find(c, test)).find(Boolean);

afterEach(() => {
  document.body.replaceChildren();
});

describe("desk.inspect.open", () => {
  it("desk.inspect.open answers the render tree, the surfaces and the settings", async () => {
    const { hub, surfaces, shortcuts, buffers, root } = await desk();
    surfaces.open({ id: "desk.inspector", title: "Inspector" });
    surfaces.open({ id: "endue.notes", title: "Notes", placement: "left" });
    surfaces.open({ id: "desk.palette", title: "Palette", placement: "overlay", hidden: true });
    // A window the shell's window host holds: detached by the runtime, placed in a pane.
    const pane = document.createElement("div");
    root.append(pane);
    pane.append(surfaces.open({ id: "endue.terminal", title: "Terminal" }, null));
    surfaces.open({ id: "scratch", title: "Scratch", srcdoc: "<p>hi</p>" });
    shortcuts.focus("desk.inspector");
    buffers.add({
      id: "endue.notes:~/a.md",
      name: "a.md",
      plugin: "endue.notes",
      path: "~/a.md",
      modified: true,
      surface: false,
    });
    buffers.add({
      id: "surface:desk.inspector",
      name: "Inspector",
      plugin: "desk.inspector",
      modified: false,
      surface: true,
    });
    hub.settings.setLayer("profile", { "desk.notify.seconds": 6 });
    hub.settings.set("desk.example.free", true);

    const tree = (await hub.commands.run(INSPECT, { section: "tree" })) as Node;
    expect(tree).toMatchObject({ tag: "div", id: "desk", box: [0, 0, 0, 0] });
    expect(Object.keys(tree.style as object)).toEqual([
      "display",
      "background-color",
      "color",
      "border-top-color",
      "opacity",
    ]);
    const section = find(tree, (n) => n["data-surface"] === "desk.inspector");
    expect(section).toMatchObject({ tag: "section", class: "desk-surface", tabindex: "-1" });
    expect(section?.children?.at(-1)).toMatchObject({
      tag: "iframe",
      sandbox: "allow-scripts",
      title: "Inspector",
    });
    expect(find(tree, (n) => n.role === "status")).toMatchObject({
      tag: "footer",
      "aria-live": "polite",
      text: "desk ready",
    });
    // The e2e snapshots (ADR 0011) read the very same tree.
    const page = { evaluate: (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) };
    expect(await e2eRenderTree(page as never)).toBe(`${JSON.stringify(tree, null, 2)}\n`);

    expect(await hub.commands.run(INSPECT, { section: "surfaces" })).toEqual({
      surfaces: [
        {
          id: "desk.inspector",
          plugin: "desk.inspector",
          title: "Inspector",
          placement: "center",
          visible: true,
          focused: true,
          asleep: false,
        },
        {
          id: "endue.notes",
          plugin: "endue.notes",
          title: "Notes",
          placement: "left",
          visible: true,
          focused: false,
          asleep: false,
        },
        {
          id: "desk.palette",
          plugin: "desk.palette",
          title: "Palette",
          placement: "overlay",
          visible: false,
          focused: false,
          asleep: false,
        },
        {
          id: "endue.terminal",
          plugin: "endue.terminal",
          title: "Terminal",
          placement: "window",
          visible: true,
          focused: false,
          asleep: false,
        },
        {
          id: "scratch",
          title: "Scratch",
          placement: "center",
          visible: true,
          focused: false,
          asleep: false,
        },
      ],
      views: [{ id: "calendar", title: "Calendar", focused: false }],
      // As desk.buffers.list answers them.
      buffers: [
        {
          id: "endue.notes:~/a.md",
          name: "a.md",
          plugin: "endue.notes",
          path: "~/a.md",
          modified: true,
          surface: false,
        },
        {
          id: "surface:desk.inspector",
          name: "Inspector",
          plugin: "desk.inspector",
          modified: false,
          surface: true,
        },
      ],
    });

    expect(await hub.commands.run(INSPECT, { section: "settings" })).toEqual([
      { key: "desk.example.free", value: true, layer: "session" },
      {
        key: "desk.notify.seconds",
        value: 6,
        layer: "profile",
        owner: "desk.notify",
        skipped: [{ layer: "init", value: "long" }],
      },
      { key: "desk.theme.contrast", value: "normal", layer: "default", owner: "desk.theme" },
      { key: "desk.theme.scheme", value: "light", layer: "init", owner: "desk.theme" },
    ]);

    await expect(hub.commands.run(INSPECT, { section: "colours" })).rejects.toThrow(
      "tree, surfaces or settings",
    );
  });

  it("counts the live frames: loaded ones, and of the windows those out of sight and asleep", async () => {
    const counts = { shown: 1, hidden: 1, asleep: 1, budget: 8 };
    const { hub, surfaces } = await desk({ counts: () => counts });
    surfaces.open({ id: "endue.notes", title: "Notes", placement: "left" });
    surfaces.open({ id: "endue.terminal", title: "Terminal" });
    surfaces.open({ id: "desk.inspector", title: "Inspector" });
    // The frame policy took the terminal's frame away: a placeholder stands in.
    surfaces.unload("endue.terminal", document.createElement("div"));
    const answer = (await hub.commands.run(INSPECT, { section: "surfaces" })) as {
      surfaces: Array<{ id: string; asleep: boolean }>;
      frames: unknown;
    };
    expect(answer.surfaces.map((s) => [s.id, s.asleep])).toEqual([
      ["endue.notes", false],
      ["endue.terminal", true],
      ["desk.inspector", false],
    ]);
    // The edge bar's frame counts as live; only the windows count against the budget.
    expect(answer.frames).toEqual({ live: 2, hidden: 1, asleep: 1, budget: 8 });
  });

  it("only the person and perm:manage holders may inspect, and no args open the inspector", async () => {
    const { core, launched, hub } = await desk();
    await expect(ask(core, "example.agent", { section: "settings" })).rejects.toThrow(
      "example.agent may not inspect the desk",
    );
    expect(await ask(core, "cli", { section: "settings" })).toContainEqual({
      key: "desk.theme.scheme",
      value: "light",
      layer: "init",
      owner: "desk.theme",
    });
    await hub.commands.run(INSPECT);
    expect(launched).toEqual([{ plugin: "desk.inspector" }]);
  });
});
