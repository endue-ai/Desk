// @vitest-environment jsdom
// The shell's part of desk.session (#76): it names the plugin windows open and not in the drawer, so
// the next start mounts them instead of leaving them asleep (ADR 0070), and puts each window that
// came back on the slot and at the pan it had, whatever order the plugins mounted in. Which slot
// each window takes is desk-wm's (crates/desk-wm/tests/edits.rs); the record and handing it back
// are the runtime's, so these run on desk-wm as WebAssembly.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { defaultLayout } from "../layout";
import type { BuffersPolicy } from "../policies/buffers";
import type { DeskContext } from "../policies/context";
import { installSession, SESSION_KEY, type SessionPart } from "../policies/session";
import { Settings } from "../settings";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { takeDesk } from "../wm/view";
import type { ShellCtx } from "./context";
import { keepShell } from "./link";
import { emptyState, Store } from "./state";

const MANAGE = { permission: "plugin:manage" } as const;
const ONE = "test.one";
const TWO = "test.two";
const AWAY = "test.away";

/** Plugin surfaces handed over in this order, each on the first slot left free. */
const adopt = (...ids: string[]): Edit[] =>
  ids.map((id) => ({ op: "adopt", id, title: id.slice("test.".length) }));

/** keepShell over desk-wm after `edits`, its part as desk.session would keep it. */
async function shell(edits: Edit[] = []) {
  const store = new Store(emptyState("en"));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const parts = new Map<string, SessionPart>();
  const runtime = {
    settings: new Settings(),
    commands: { run: async () => undefined },
    keep: (name: string, part: SessionPart) => {
      parts.set(name, part);
      return () => parts.delete(name);
    },
  };
  const kept = keepShell({ store, wm, runtime, wall: () => 0 } as unknown as ShellCtx);
  const part = parts.get("shell");
  if (!part) throw new Error("the shell kept no part");
  await wm.edit(edits);
  return { store, wm, part, kept };
}

/** The windows handed over, by id, title, slot and the pan each arrived at. */
const adopted = (store: Store) =>
  store
    .get()
    .adopted.map(({ id, title, slot, at }) => ({ id, title, slot, ...(at ? { at } : {}) }));

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

/**
 * Three plugin windows open, on the slots and pans a session kept for them, the third put away in
 * the drawer.
 */
const OPEN: Edit[] = [
  ...adopt(ONE, TWO, AWAY),
  {
    op: "restore",
    desktop: null,
    pan: null,
    slots: {
      [ONE]: { slot: 2 },
      [TWO]: { slot: 0, at: { x: -400, y: 120 } },
      [AWAY]: { slot: 1 },
    },
    now: 1,
  },
  { op: "put-away", id: AWAY, name: "away", now: 1 },
];

describe("the shell's part of desk.session keeps the windows open", () => {
  it("a saved shell part with two windows makes shows() include both; one in the drawer is left out", async () => {
    const { part } = await shell(OPEN);
    const saved = part.save() as { shows?: string[] };
    expect(saved.shows).toEqual([ONE, TWO]);

    const shown = await nextStartShows(saved);
    expect(shown?.has(ONE)).toBe(true);
    expect(shown?.has(TWO)).toBe(true);
    expect(shown?.has(AWAY)).toBe(false);
  });

  it("restored, each window that came back takes its saved slot and pan, and one it did not save a free slot", async () => {
    const saved = JSON.parse(JSON.stringify((await shell(OPEN)).part.save()));
    // The next start: the plugins mounted in their own order, each on the first slot left free.
    const next = await shell(adopt(ONE, "test.new", TWO));
    next.part.restore(saved);
    await next.kept.done();

    expect(adopted(next.store)).toEqual([
      { id: ONE, title: "one", slot: 2 },
      { id: "test.new", title: "new", slot: 1 },
      { id: TWO, title: "two", slot: 0, at: { x: -400, y: 120 } },
    ]);
  });

  it("a window the save put on a slot another took moves that one to a free slot", async () => {
    const next = await shell(adopt("test.new", ONE));
    next.part.restore({ shows: [ONE], slots: { [ONE]: { slot: 0 } } });
    await next.kept.done();

    expect(adopted(next.store)).toEqual([
      { id: "test.new", title: "new", slot: 1 },
      { id: ONE, title: "one", slot: 0 },
    ]);
  });

  it("a window opened or closed saves the session soon", async () => {
    const { wm, part } = await shell(OPEN);
    let heard = 0;
    const off = part.onChange(() => heard++);
    await wm.edit([{ op: "release", id: ONE }]);
    expect(heard).toBe(1);
    await wm.edit(adopt(ONE));
    expect(heard).toBe(2);
    off();
  });
});
