/// <reference types="vite/client" />
// Test page: the desk shell as a start that found something (ADR 0061), on the stubs. The core's
// store lives in localStorage, so each page load is one more desk start. ?safe=asked|crash-loop with
// ?held=a,b; ?broken=store.json,plugins.json (kept under /data); ?throws=1 installs test.throws,
// which fails to start; ?session=torn stores a session that cannot be put back; ?failed=N; ?lang=en; ?settle=1.
// The stub holds off what the core would: every plugin but the desk.* policies in safe mode, and
// the quarantined plugins at their listed version. Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import "../../src/shell/styles";
import { browserBridge } from "../../src/bridge/browser";
import { browserCore, localStore } from "../../src/bridge/core";
import { ManualClock } from "../../src/clock";
import { mountDesk } from "../../src/shell/Desk";
import { sampleState } from "../../src/shell/state";
import type { StartInfo } from "../../src/start";
import { pageWindowManager } from "./wm-host";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const params = new URLSearchParams(location.search);
const list = (name: string) => (params.get(name) ?? "").split(",").filter(Boolean);
const clock = new ManualClock();
const manifests = Object.values(
  import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
    eager: true,
    import: "default",
  }),
).filter(
  (m) =>
    m.id.startsWith("desk.") && m.id !== "desk.views" && m.kind !== "view" && m.kind !== "pack",
);
const throws: PluginManifest = {
  id: "test.throws",
  name: "Throws",
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: "Throws", placement: "center" }],
};
const installed = [...manifests, ...(params.has("throws") ? [throws] : [])];

const store = localStore("desk.safe.");
if (params.get("session") === "torn") store.set("session", { version: 1, files: "torn" });
// ?failed=2: test.throws already failed two starts in a row, so this one quarantines it.
const failed = Number(params.get("failed") ?? 0);
if (failed > 0)
  store.set("plugins.failures", { "test.throws": { version: "0.1.0", starts: failed } });
const safe = params.get("safe");
const start: StartInfo = {
  broken: list("broken").map((name) => ({ name, path: `/data/${name}.broken` })),
  dataDir: "/data",
  ...(safe === "asked" || safe === "crash-loop"
    ? { safe: { reason: safe, heldOff: list("held") } }
    : {}),
};
const quarantined = (store.get("plugins.quarantined") ?? []) as Array<{
  id: string;
  version: string;
}>;
const off = installed
  .filter((m) =>
    start.safe
      ? !(m.kind === "policy" && m.id.startsWith("desk."))
      : quarantined.some((q) => q.id === m.id && q.version === m.version),
  )
  .map((m) => m.id);
const core = browserCore({ manifests: installed, off, store, init: { profile: "morning" } });

const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const lang = params.get("lang") === "en" ? "en" : "ko";
const page = { relaunched: 0 };
const desk = mountDesk({
  // desk-wm as WebAssembly: this page has no compositor (#83).
  windowManager: await pageWindowManager(),
  root,
  bridge: browserBridge({ now: () => clock.now(), epoch }),
  core: core.client,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  clock,
  epoch,
  platform: "mac",
  lang,
  seed: sampleState(lang, epoch),
  start,
  relaunch: () => {
    page.relaunched++;
  },
});

Object.assign(window, { __safe: { desk, clock, core, page, store } });
// ?settle=1: once ready, run the clock a second so the status line has faded in (for pictures).
if (params.has("settle")) {
  void desk.ready.then(() => {
    for (let ms = 0; ms < 1000; ms += 16) clock.advance(16);
  });
}
