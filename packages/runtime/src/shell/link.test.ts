// @vitest-environment jsdom
// The shell's part of desk.session (#76): it names the plugin windows open and not in the drawer, so
// the next start mounts them instead of leaving them asleep (ADR 0070), and puts each window that
// came back on the slot and at the pan it had, whatever order the plugins mounted in.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { defaultLayout } from "../layout";
import type { BuffersPolicy } from "../policies/buffers";
import type { DeskContext } from "../policies/context";
import { installSession, SESSION_KEY, type SessionPart } from "../policies/session";
import { Settings } from "../settings";
import type { ShellCtx } from "./context";
import { keepShell } from "./link";
import { type DeskState, emptyState, Store } from "./state";

const MANAGE = { permission: "plugin:manage" } as const;
const ONE = "test.one";
const TWO = "test.two";
const AWAY = "test.away";

/** keepShell over a store that starts with `state`, its part as desk.session would keep it. */
function shell(state: Partial<DeskState> = {}) {
  const store = new Store({ ...emptyState("en"), ...state });
  const parts = new Map<string, SessionPart>();
  const runtime = {
    settings: new Settings(),
    commands: { run: async () => undefined },
    keep: (name: string, part: SessionPart) => {
      parts.set(name, part);
      return () => parts.delete(name);
    },
  };
  const kept = keepShell({ store, runtime, wall: () => 0 } as unknown as ShellCtx);
  const part = parts.get("shell");
  if (!part) throw new Error("the shell kept no part");
  return { store, part, kept };
}

/** What desk.session on the stub core shows at the next start, given the shell part it saved. */
async function nextStartShows(shellPart: unknown) {
  const saved = {
    version: 1,
    layout: defaultLayout(),
    files: [],
    focused: null,
    notices: [],
    parts: { shell: JSON.parse(JSON.stringify(shellPart)) },
  };
  const manifests: PluginManifest[] = [{ id: "desk.session", version: "0.1.0", kind: "policy" }];
  const core = browserCore({ manifests, store: memoryStore({ [SESSION_KEY]: saved }) });
  const hub = new PolicyHub(core.client);
  hub.apply((await core.client.call("plugin.list", { scope: MANAGE })).plugins);
  const ctx = { hub, bridge: core.client, win: window, surfaces: { get: () => undefined } };
  const buffers = { buffers: { list: () => [], onChange: () => () => {} } };
  const session = installSession(
    ctx as unknown as DeskContext,
    buffers as unknown as BuffersPolicy,
    {
      layout: defaultLayout,
      setLayout: () => {},
      focus: () => {},
      focused: () => null,
      notices: () => [],
      restoreNotices: () => {},
    },
  );
  const shown = await session.shows();
  session.dispose();
  return shown;
}

/** Three plugin windows open, the third put away in the drawer. */
const OPEN: Partial<DeskState> = {
  adopted: [
    { id: ONE, title: "One", slot: 2 },
    { id: TWO, title: "Two", slot: 0, at: { x: -400, y: 120 } },
    { id: AWAY, title: "Away", slot: 1 },
  ],
  drawer: [
    {
      id: `surface-${AWAY}`,
      kind: "surface",
      name: "Away",
      at: 1,
      placement: { id: AWAY, plugin: AWAY, x: 0, y: 0, w: 400, h: 300, pinned: false },
    },
  ],
};

describe("the shell's part of desk.session keeps the windows open", () => {
  it("a saved shell part with two windows makes shows() include both; one in the drawer is left out", async () => {
    const { part } = shell(OPEN);
    const saved = part.save() as { shows?: string[] };
    expect(saved.shows).toEqual([ONE, TWO]);

    const shown = await nextStartShows(saved);
    expect(shown?.has(ONE)).toBe(true);
    expect(shown?.has(TWO)).toBe(true);
    expect(shown?.has(AWAY)).toBe(false);
  });

  it("restored, each window that came back takes its saved slot and pan, and one it did not save a free slot", async () => {
    const saved = JSON.parse(JSON.stringify(shell(OPEN).part.save()));
    // The next start: the plugins mounted in their own order, each on the first slot left free.
    const next = shell({
      adopted: [
        { id: ONE, title: "One", slot: 0 },
        { id: "test.new", title: "New", slot: 1 },
        { id: TWO, title: "Two", slot: 2 },
      ],
    });
    next.part.restore(saved);
    await next.kept.done();

    expect(next.store.get().adopted).toEqual([
      { id: ONE, title: "One", slot: 2 },
      { id: "test.new", title: "New", slot: 1 },
      { id: TWO, title: "Two", slot: 0, at: { x: -400, y: 120 } },
    ]);
  });

  it("a window the save put on a slot another took moves that one to a free slot", async () => {
    const next = shell({
      adopted: [
        { id: "test.new", title: "New", slot: 0 },
        { id: ONE, title: "One", slot: 1 },
      ],
    });
    next.part.restore({ shows: [ONE], slots: { [ONE]: { slot: 0 } } });
    await next.kept.done();

    expect(next.store.get().adopted).toEqual([
      { id: "test.new", title: "New", slot: 1 },
      { id: ONE, title: "One", slot: 0 },
    ]);
  });

  it("a window opened or closed saves the session soon", () => {
    const { store, part } = shell(OPEN);
    let heard = 0;
    const off = part.onChange(() => heard++);
    store.set((s) => ({ adopted: s.adopted.filter((a) => a.id !== ONE) }));
    expect(heard).toBe(1);
    off();
  });
});
