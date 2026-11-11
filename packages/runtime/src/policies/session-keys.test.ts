// @vitest-environment jsdom
// The surface in use has the keys at the end of a start (issue 163, finding 11): in the app its
// place in the desk's page has the page's focus, which the compositor gives the keys to (ADR 0150,
// ADR 0160). The runtime focuses a surface its display rules focus as it mounts, before its window
// is in the page, which kept no focus: the keys went nowhere until a click.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { remotePages } from "../pages/remote";
import { SurfaceHost } from "../surfaces";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installSession, SESSION_KEY } from "./session";

const TERMINAL = "example.terminal";
const NOTES = "example.notes";
const policy = (id: string): PluginManifest => ({ id, version: "0.1.0", kind: "policy" });

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * desk.session on the stub core over remote surface pages, with `saved` in the store and two
 * windowed surfaces, Terminal in use. Their sections are detached, as the runtime's are until
 * the shell's windows place them (`place`).
 */
async function desk(saved: unknown) {
  const core = browserCore({
    manifests: [policy("desk.session"), policy("desk.buffers")],
    store: memoryStore(saved ? { [SESSION_KEY]: saved } : {}),
  });
  const hub = new PolicyHub(core.client);
  const transport = { post: () => {}, listen: () => () => {} };
  const surfaces = new SurfaceHost(
    document.body,
    () => {},
    undefined,
    remotePages(window, transport),
  );
  const sections = new Map(
    [TERMINAL, NOTES].map((id) => {
      const src = `desk-plugin://main.${id.replace(".", "-")}/${id}/ui/index.html`;
      return [id, surfaces.open({ id, title: id, src }, null)];
    }),
  );
  let focused: string | null = null;
  const focus = (id: string) => {
    focused = id;
    surfaces.focus(id);
  };
  const ctx = {
    hub,
    bridge: core.client,
    win: window,
    surfaces,
    share: () => {},
    request: async () => null,
    mounted: () => true,
    launch: async () => {},
    whenReady: async () => {},
    unmount: () => {},
  } as unknown as DeskContext;
  const buffers = installBuffers(ctx, { focus });
  const session = installSession(ctx, buffers, {
    focus,
    focused: () => focused,
    notices: () => [],
    restoreNotices: () => {},
  });
  hub.apply(core.plugins);
  await hub.commands.settled();
  // The display rules focus Terminal as it mounts, its window not in the page yet.
  focus(TERMINAL);
  const place = (id: string) => document.body.append(sections.get(id) as HTMLElement);
  /** The surface host whose place has the page's focus, as the page reports it to the compositor. */
  const keys = () =>
    document.activeElement?.closest<HTMLElement>("[data-surface-host]")?.dataset.surfaceHost ??
    null;
  return { session, place, keys, focus, sections };
}

describe("the surface in use has the keys at the end of a start", () => {
  it("a fresh start: Terminal, focused before its window was in the page, takes them", async () => {
    const d = await desk(undefined);
    d.place(TERMINAL);
    d.place(NOTES);
    expect(d.keys(), "focused while detached: nothing has the focus").toBeNull();
    await d.session.restore();
    expect(d.keys()).toBe("main.example-terminal");
  });

  it("a relaunch: the surface the session puts back in use takes them, not only its window", async () => {
    const d = await desk({ version: 1, files: [], focused: TERMINAL, notices: [] });
    d.place(TERMINAL);
    d.place(NOTES);
    await d.session.restore();
    expect(d.keys()).toBe("main.example-terminal");
  });

  it("an element of the desk's own that took the focus during the start keeps it", async () => {
    const d = await desk(undefined);
    d.place(TERMINAL);
    const question = document.createElement("button");
    document.body.append(question);
    question.focus();
    await d.session.restore();
    expect(document.activeElement).toBe(question);
  });

  it("a surface whose window is not in the page takes nothing", async () => {
    const d = await desk(undefined);
    await d.session.restore();
    expect(d.keys()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
