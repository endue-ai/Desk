// @vitest-environment jsdom
// Surface pages in browsers of their own (ADR 0160): the desk's page holds no frame for a plugin, and
// the plugin host's messages go through the shell, keyed by the surface's host.
import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime } from "../runtime";
import { remotePages, type SurfaceTransport, surfaceHostOf } from "./remote";

const HOST = "main.test-notes";
const URL = `desk-plugin://${HOST}/test.notes/ui/index.html?v=1`;

function notes(): PluginInfo {
  return {
    id: "test.notes",
    status: "ready",
    enabled: true,
    builtIn: false,
    revision: 1,
    manifest: {
      id: "test.notes",
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: "Notes", placement: "overlay" }],
    },
  } as PluginInfo;
}

/** The shell's side: what the desk sent each surface, and a way to post as a surface's page. */
function shell() {
  const sent: Array<[string, unknown]> = [];
  let receive: (host: string, text: string) => void = () => {};
  const transport: SurfaceTransport = {
    post: (host, text) => sent.push([host, JSON.parse(text)]),
    listen: (r) => {
      receive = r;
      return () => {
        receive = () => {};
      };
    },
  };
  return {
    transport,
    sent,
    types: (host = HOST) =>
      sent.filter(([h]) => h === host).map(([, m]) => (m as { type: string }).type),
    say: (host: string, message: unknown) => receive(host, JSON.stringify(message)),
  };
}

async function desk() {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [notes()] }),
    "perm.query": () => ({ grants: [] }),
  });
  const s = shell();
  const pages = remotePages(window, s.transport);
  const runtime = createRuntime({
    root,
    bridge: new BridgeClient(stub),
    pages,
    plugins: {
      url: (id, path, revision, surface) =>
        `desk-plugin://${surface}.test-notes/${id}/${path}?v=${revision}`,
    },
  });
  await runtime.plugins?.ready;
  return { root, runtime, pages, ...s };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => document.body.replaceChildren());

describe("remote surface pages", () => {
  it("name a plugin surface by its host, never by a frame", () => {
    expect(surfaceHostOf(URL)).toBe(HOST);
    for (const src of ["desk-plugin://localhost/_desk/x", "desk-app://app/", "about:blank", ""])
      expect(surfaceHostOf(src), src).toBeUndefined();
  });

  it("keep no frame in the desk's page: the plugin's hello comes from the shell and its init goes back there", async () => {
    const d = await desk();
    const section = d.root.querySelector('[data-surface="test.notes"]');
    expect(section?.querySelector("iframe")).toBeNull();
    const place = section?.querySelector<HTMLElement>("[data-surface-host]");
    expect(place?.dataset.surfaceHost).toBe(HOST);
    expect(d.pages.list()).toMatchObject([
      { id: "test.notes", host: HOST, src: URL, loads: 1, away: false },
    ]);

    d.say(HOST, { type: "desk:hello" });
    await settle();
    const init = d.sent.find(([, m]) => (m as { type: string }).type === "desk:init");
    expect(init).toEqual([
      HOST,
      expect.objectContaining({ type: "desk:init", pluginId: "test.notes" }),
    ]);
    // A host the desk does not show is nobody's: what it says reaches no plugin.
    d.say("main.someone-else", { type: "desk:close" });
    await settle();
    expect(d.runtime.plugins?.mounted()).toContain("test.notes");
    d.say(HOST, { type: "desk:close" });
    await settle();
    expect(d.runtime.plugins?.mounted()).not.toContain("test.notes");
    expect(d.pages.list()).toEqual([]);
    d.runtime.dispose();
  });

  it("count each load of a page, and give a page back after an unload a new port", async () => {
    const d = await desk();
    const port =
      d.runtime.plugins &&
      (d.pages.port("test.notes", d.pages.list()[0]?.view as HTMLElement) as Window);
    expect(port).toBeTruthy();
    d.pages.load("test.notes", d.pages.list()[0]?.view as HTMLElement, `${URL}2`);
    expect(d.pages.list()[0]).toMatchObject({ src: `${URL}2`, loads: 2 });
    const view = d.pages.list()[0]?.view as HTMLElement;
    d.pages.away("test.notes", view);
    expect(d.pages.port("test.notes", view)).toBeNull();
    // Away, what its old page says goes nowhere.
    d.say(HOST, { type: "desk:hello" });
    await settle();
    expect(d.types()).not.toContain("desk:init");
    d.pages.back("test.notes", view, false);
    const again = d.pages.port("test.notes", view);
    expect(again).not.toBe(port);
    expect(d.pages.list()[0]).toMatchObject({ loads: 3, away: false });
    d.runtime.dispose();
  });

  it("put the page's focus on a surface's place when the desk gives the surface the focus", async () => {
    const d = await desk();
    const section = d.root.querySelector<HTMLElement>('[data-surface="test.notes"]');
    const place = section?.querySelector<HTMLElement>("[data-surface-host]");
    d.runtime.focusSurface("test.notes");
    // The place, not its section: the compositor gives the keys to the surface whose place has the
    // page's focus (issue 159, finding 2: Ctrl+Tab left them with the desk's page).
    expect(document.activeElement).toBe(place);
    // Away (unloaded), the section keeps it; back, the place takes it again.
    const view = place as HTMLElement;
    d.pages.away("test.notes", view);
    view.remove();
    d.runtime.focusSurface("test.notes");
    expect(document.activeElement).toBe(section);
    section?.append(view);
    d.pages.back("test.notes", view, true);
    expect(document.activeElement).toBe(place);
    d.runtime.dispose();
  });

  it("enter a surface's page with Tab, and leave it by the page's own order", async () => {
    const d = await desk();
    const section = d.root.querySelector<HTMLElement>('[data-surface="test.notes"]');
    const place = section?.querySelector<HTMLElement>("[data-surface-host]");
    const [first, last] = [...(place?.querySelectorAll<HTMLElement>("[data-edge]") ?? [])];
    expect([first?.dataset.edge, last?.dataset.edge]).toEqual(["first", "last"]);
    first?.focus();
    expect(d.sent.at(-1)).toEqual([HOST, { type: "desk:surface-enter", edge: "first" }]);
    expect(document.activeElement, "the focus rests on the place").toBe(place);
    // The plugin's page tabbed past its last control: the focus goes to the last edge, and the shell
    // is asked for one more Tab in this page.
    d.say(HOST, { type: "desk:surface-leave", next: true });
    expect(document.activeElement).toBe(last);
    expect(d.sent.at(-1)).toEqual([HOST, { type: "desk:surface-tab", back: false }]);
    expect(d.types().filter((t) => t === "desk:surface-enter")).toHaveLength(1);
    d.runtime.dispose();
  });
});
