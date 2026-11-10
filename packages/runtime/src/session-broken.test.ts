// @vitest-environment jsdom
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "./bridge/core";
import { ManualClock } from "./clock";
import { PolicyHub } from "./hub";
import type { BuffersPolicy } from "./policies/buffers";
import type { DeskContext } from "./policies/context";
import { installSession, SESSION_KEY } from "./policies/session";

const MANAGE = { permission: "plugin:manage" } as const;
const policy = (id: string): PluginManifest => ({ id, version: "0.1.0", kind: "policy" });

/** desk.session on the stub core over `store`, with no buffers; what it put back is in `set`. */
async function session(store: Record<string, unknown>, options: { hold?: boolean } = {}) {
  const core = browserCore({ manifests: [policy("desk.session")], store: memoryStore(store) });
  const bridge = core.client;
  const hub = new PolicyHub(bridge);
  hub.apply((await bridge.call("plugin.list", { scope: MANAGE })).plugins);
  const ctx = {
    hub,
    bridge,
    win: window,
    clock: new ManualClock(),
    surfaces: { get: () => undefined },
  };
  const buffers = { buffers: { list: () => [], onChange: () => () => {} } };
  const set: string[] = [];
  const broken: string[] = [];
  const desk = installSession(
    ctx as unknown as DeskContext,
    buffers as unknown as BuffersPolicy,
    {
      focus: (id) => set.push(`focus ${id}`),
      focused: () => null,
      notices: () => [],
      restoreNotices: () => set.push("notices"),
    },
    { ...options, broken: (key) => broken.push(key) },
  );
  return { policy: desk, set, broken, core };
}

describe("a session that fails to restore", () => {
  it("starts an empty desk, keeps the record as session.broken and says so once", async () => {
    const torn = { version: 1, files: "torn in half", notices: 3 };
    const store: Record<string, unknown> = { [SESSION_KEY]: torn };
    const { policy, set, broken } = await session(store);

    await policy.restore();

    expect(set, "nothing of it is put back").toEqual([]);
    expect(store[`${SESSION_KEY}.broken`]).toEqual(torn);
    expect(store[SESSION_KEY]).toBeNull();
    expect(broken).toEqual([SESSION_KEY]);
  });

  it("treats a record of another version the same way", async () => {
    const store: Record<string, unknown> = { [SESSION_KEY]: { version: 7 } };
    const { policy, broken } = await session(store);
    await policy.restore();
    expect(broken).toEqual([SESSION_KEY]);
    expect(store[`${SESSION_KEY}.broken`]).toEqual({ version: 7 });
  });

  it("says nothing when there is no saved session", async () => {
    const store: Record<string, unknown> = { [SESSION_KEY]: null };
    const { policy, broken } = await session(store);
    await policy.restore();
    expect(broken).toEqual([]);
    expect(`${SESSION_KEY}.broken` in store).toBe(false);
  });

  it("neither restores nor saves while held, in safe mode", async () => {
    const saved = { version: 1, files: [], focused: null, notices: [] };
    const store: Record<string, unknown> = { [SESSION_KEY]: saved };
    const { policy, set } = await session(store, { hold: true });
    await policy.restore();
    await policy.save();
    expect(set).toEqual([]);
    expect(store[SESSION_KEY], "the normal session waits for a normal start").toEqual(saved);
  });
});
