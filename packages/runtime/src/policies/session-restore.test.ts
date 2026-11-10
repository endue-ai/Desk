import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore, memoryStore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";
import { installSession, SESSION_KEY } from "./session";

const NOTES = "example.notes";
const SHEETS = "example.sheets";
const DATA = "example.data";
/** Saved least recently used first: c.json was in use last. */
const FILES = [
  { path: "~/a.md", plugin: NOTES },
  { path: "~/b.csv", plugin: SHEETS },
  { path: "~/c.json", plugin: DATA },
];
const [A, B, C] = FILES.map((file) => `file:${file.path}`) as [string, string, string];

const policy = (id: string): PluginManifest => ({ id, version: "0.1.0", kind: "policy" });
const viewer = (id: string, pattern: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id, placement: "center" }],
  contributes: { files: [{ pattern, plugin: id }] },
});

/** Settle a held promise: true answers it, false refuses it. */
type Release = (ok: boolean) => void;

/**
 * desk.session, desk.files and desk.buffers on the stub core over a saved session of three files in
 * three viewers, all mounted. The test holds a viewer's readiness or a file's visit and lets it go.
 */
async function desk() {
  const saved = { version: 1, files: FILES, focused: NOTES, notices: [] };
  const core = browserCore({
    manifests: [
      policy("desk.session"),
      policy("desk.files"),
      policy("desk.buffers"),
      viewer(NOTES, "*.md"),
      viewer(SHEETS, "*.csv"),
      viewer(DATA, "*.json"),
    ],
    store: memoryStore({ [SESSION_KEY]: saved }),
  });
  const hub = new PolicyHub(core.client);
  /** What the viewers were asked and where the focus went, in order. */
  const log: string[] = [];
  /** Readiness held by plugin, visits held by path. */
  const ready = new Map<string, Promise<void>>();
  const visits = new Map<string, Promise<void>>();
  const hold = (gates: Map<string, Promise<void>>, key: string): Release => {
    let release: Release = () => {};
    const gate = new Promise<void>((resolve, reject) => {
      release = (ok) => (ok ? resolve() : reject(new Error("Not allowed to read it.")));
    });
    gates.set(key, gate);
    return release;
  };
  const request = async (_plugin: string, command: string, args?: { buffer?: string }) => {
    log.push(`${command} ${args?.buffer ?? ""}`);
    const path = (args as { path?: string } | undefined)?.path ?? "";
    if (command === "desk.files.visit") await visits.get(path);
    return null;
  };
  const ctx = {
    hub,
    bridge: core.client,
    win: {
      setTimeout: () => 0,
      clearTimeout: () => {},
      addEventListener() {},
      removeEventListener() {},
    },
    surfaces: { show: () => {}, get: () => ({}) },
    share: () => {},
    request,
    mounted: () => true,
    launch: async () => {},
    whenReady: (plugin: string) => ready.get(plugin) ?? Promise.resolve(),
    unmount: () => {},
  } as unknown as DeskContext;
  let focused: string | null = null;
  const focus = (id: string) => {
    focused = id;
    log.push(`focus ${id}`);
  };
  const buffers = installBuffers(ctx, { focus });
  const files = installFiles(ctx, buffers, vi.fn());
  const session = installSession(ctx, buffers, {
    focus,
    focused: () => focused,
    notices: () => [],
    restoreNotices: () => {},
  });
  hub.apply(core.plugins);
  await hub.commands.settled();
  const shows = () => log.filter((line) => line.startsWith("desk.buffers.show"));
  const visited = (...ids: string[]) =>
    vi.waitFor(() =>
      expect(log).toEqual(expect.arrayContaining(ids.map((id) => `desk.files.visit ${id}`))),
    );
  return { hub, log, ready, visits, hold, buffers, files, session, shows, visited };
}

/** Let the visits the test did not hold answer, and whatever follows them run. */
const quiet = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("desk.session opens the saved files together, in the saved order", () => {
  it("starts every saved file's open together: a slow first viewer does not delay the others", async () => {
    const d = await desk();
    const notesReady = d.hold(d.ready, NOTES);
    const restoring = d.session.restore();

    await d.visited(B, C);
    expect(d.log, "the first file waits for its viewer").not.toContain(`desk.files.visit ${A}`);

    notesReady(true);
    await restoring;
    expect(d.buffers.buffers.list().map((buffer) => buffer.id)).toEqual([C, B, A]);
  });

  it("shows the files in the saved order when a later viewer is ready first, and the saved surface keeps the focus", async () => {
    const d = await desk();
    const notesReady = d.hold(d.ready, NOTES);
    const restoring = d.session.restore();

    await d.visited(B, C);
    await quiet();
    expect(d.shows(), "nothing shows before the first saved file").toEqual([]);

    notesReady(true);
    await restoring;
    expect(d.shows()).toEqual([A, B, C].map((id) => `desk.buffers.show ${id}`));
    expect(d.buffers.buffers.list().map((buffer) => buffer.id)).toEqual([C, B, A]);
    const snapshot = (await d.hub.commands.run("desk.session.save")) as { files: unknown };
    expect(snapshot.files, "the next start opens them the same way").toEqual(FILES);
    expect(d.files.recent().map((file) => file.path)).toEqual(["~/c.json", "~/b.csv", "~/a.md"]);
    expect(d.log.at(-1), "the saved surface, not the last file's viewer").toBe(`focus ${NOTES}`);
    expect(d.log.lastIndexOf(`focus ${NOTES}`)).toBeGreaterThan(
      d.log.indexOf(`desk.buffers.show ${C}`),
    );
  });

  it("one file that fails does not stop the others", async () => {
    const d = await desk();
    const refuse = d.hold(d.visits, "~/a.md");
    const restoring = d.session.restore();

    await d.visited(A, B, C);
    refuse(false);
    await restoring;

    expect(d.shows()).toEqual([B, C].map((id) => `desk.buffers.show ${id}`));
    expect(d.buffers.buffers.byPath("~/a.md")).toBeUndefined();
    expect(d.buffers.buffers.list().map((buffer) => buffer.id)).toEqual([C, B]);
    expect(d.log.at(-1)).toBe(`focus ${NOTES}`);
  });

  it("a file the person opens while the restore visits it shows when the visit lands", async () => {
    const d = await desk();
    const notesReady = d.hold(d.ready, NOTES);
    const readC = d.hold(d.visits, "~/c.json");
    const restoring = d.session.restore();

    await d.visited(B, C);
    const opened = d.hub.commands.run("desk.files.open", { path: "~/c.json" });
    await quiet();
    readC(true);
    await expect(opened).resolves.toBe(C);
    expect(d.shows(), "the person's open shows it").toEqual([`desk.buffers.show ${C}`]);

    notesReady(true);
    await restoring;
    expect(d.log.filter((line) => line === `desk.files.visit ${C}`)).toHaveLength(1);
    expect(d.buffers.buffers.list().map((buffer) => buffer.id)).toEqual([C, B, A]);
  });
});
