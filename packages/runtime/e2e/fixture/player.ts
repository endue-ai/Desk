// Test page: endue.player (plugins/player) over the desk.* policies on the browser stub, with a few of
// the plugin's own fixtures as files: a VP9 video, an Ogg song, and a playlist of the song and a FLAC
// one, in the frame a plugin page gets. Never shipped.
import type { PluginManifest, StubHandlers } from "@endue-ai/bridge";
import playerManifest from "../../../../plugins/player/plugin.json";
import webm from "../../../../plugins/player/tests/fixtures/clip.webm?inline";
import flac from "../../../../plugins/player/tests/fixtures/tone.flac?inline";
import ogg from "../../../../plugins/player/tests/fixtures/tone.ogg?inline";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const text = (words: string) => `data:audio/x-mpegurl;base64,${btoa(words)}`;
const files: Record<string, string> = {
  "~/Movies/clip.webm": webm,
  "~/Music/tone.ogg": ogg,
  "~/Music/tone.flac": flac,
  "~/Music/mix.m3u": text("#EXTM3U\n#EXTINF:1,Ogg\ntone.ogg\n#EXTINF:1,FLAC\ntone.flac\n"),
};
const bytesOf = (url: string) =>
  Uint8Array.from(atob(url.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
const fixture = (path: string) => {
  const url = files[path];
  if (!url) throw new Error(`No fixture ${path}`);
  return url;
};

/** The files as the core serves them: fs.url, ranged fs.read in base64, fs.list and fs.watch. */
const handlers: StubHandlers = {
  "fs.url": ({ path }) => {
    const url = fixture(path);
    return { url, type: url.slice(5, url.indexOf(";")), size: bytesOf(url).length };
  },
  "fs.read": ({ path, offset = 0, length }) => {
    const bytes = bytesOf(fixture(path));
    const part = bytes.subarray(offset, length === undefined ? undefined : offset + length);
    return { content: btoa(String.fromCharCode(...part)), encoding: "base64", size: bytes.length };
  },
  "fs.list": ({ path }) => ({
    entries: Object.keys(files)
      .filter((p) => p.slice(0, p.lastIndexOf("/")) === path)
      .map((p) => ({ name: p.slice(p.lastIndexOf("/") + 1), kind: "file" as const })),
  }),
  "fs.watch": ({ path }) => ({ watchId: `watch:${path}` }),
};

const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, playerManifest as PluginManifest],
  handlers,
  open: () => {},
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub: core.stub, commands: [] };
