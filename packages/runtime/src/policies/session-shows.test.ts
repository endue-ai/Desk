// @vitest-environment jsdom
// What a saved session shows (#590, #76): the grid's cells, the plugins of the saved files, the
// surface in use, and the surfaces each saved part names in its `shows` (the shell's open windows),
// read before the plugins mount. desk.session reads the parts' values as data, without the shell.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { defaultLayout } from "../layout";
import type { BuffersPolicy } from "./buffers";
import type { DeskContext } from "./context";
import { installSession, SESSION_KEY } from "./session";

const MANAGE = { permission: "plugin:manage" } as const;
const policy = (id: string): PluginManifest => ({ id, version: "0.1.0", kind: "policy" });

/** desk.session on the stub core over a saved session with `parts`. */
async function shows(parts: unknown) {
  const saved = {
    version: 1,
    layout: defaultLayout(),
    files: [{ path: "~/a.md", plugin: "test.notes" }],
    focused: "test.focused",
    notices: [],
    parts,
  };
  const core = browserCore({
    manifests: [policy("desk.session")],
    store: memoryStore({ [SESSION_KEY]: saved }),
  });
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

describe("desk.session shows what its parts name", () => {
  it("counts the surfaces each saved part names in its shows, beside the files and the one in use", async () => {
    const shown = await shows({
      shell: { layouts: {}, drawer: [], shows: ["test.one", "test.two"] },
      other: { shows: ["test.three"] },
      plain: { pan: {} },
    });
    expect([...(shown ?? [])].sort()).toEqual(
      ["test.focused", "test.notes", "test.one", "test.three", "test.two"].sort(),
    );
  });

  it("a part's shows that is not a list of ids adds nothing", async () => {
    const shown = await shows({
      shell: { shows: "test.one" },
      other: { shows: [7, null, { id: "test.two" }, "test.three"] },
      empty: null,
    });
    expect([...(shown ?? [])].sort()).toEqual(["test.focused", "test.notes", "test.three"].sort());
    expect(await shows("not parts")).toEqual(new Set(["test.notes", "test.focused"]));
  });
});
