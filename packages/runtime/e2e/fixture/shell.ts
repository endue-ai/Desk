/// <reference types="vite/client" />
// Test page: the desk shell on the browser bridge stubs (the core's and the shell's), a manual clock
// and in-memory storage. ?lang=en, ?persist=1 (the core's store in localStorage), ?reduced=1
// (desk.theme.motion: reduce), ?init={...} (more init.yaml settings), ?themes=1 (the test theme
// plugin installed), ?studio=1 (the theme studio open once the desk is ready; ?studio=<theme id>
// previews that theme too; ?edit=<theme id> opens the editor on a copy of it; ?describe=<sentence>
// runs Describe on it; ?say=<sentence> says it to Eris through the composer). brain.ask answers as
// examples/brain-echo does (propose_theme from the words of the prompt's last line). Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import "../../src/shell/styles";
import { proposeTheme } from "../../../../examples/brain-echo/theme.mjs";
import { browserBridge, type Envelope } from "../../src/bridge/browser";
import { browserCore, localStore, memoryStore } from "../../src/bridge/core";
import erisReply from "../../src/bridge/envelopes/eris-reply.json";
import userHello from "../../src/bridge/envelopes/user-hello.json";
import { ManualClock } from "../../src/clock";
import { mountDesk } from "../../src/shell/Desk";
import { sampleState } from "../../src/shell/state";
import testTheme from "../themes/test-theme/plugin.json";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const params = new URLSearchParams(location.search);
const clock = new ManualClock();
// The desk.* policies (the shell's own included) and the palette: the plugin chrome the shell
// replaces (dock, toolbar, sidebar) is not installed here, nor the view engine and the view plugins
// (views.html has them).
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
// ?plugins=1 adds the UI test plugins, whose centre surfaces open as the shell's windows.
const testPlugins: PluginManifest[] = [
  {
    id: "test.counter",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Counter", placement: "center" }],
  },
  {
    id: "example.hello-ui",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [{ id: "main", title: "Hello", placement: "center" }],
  },
];
const core = browserCore({
  manifests: [
    ...Object.values(manifests).filter(
      (m) => m.id.startsWith("desk.") && m.id !== "desk.views" && m.kind !== "view",
    ),
    ...(params.has("plugins") ? testPlugins : []),
    ...(params.has("themes") ? [testTheme as PluginManifest] : []),
  ],
  store: params.has("persist") ? localStore("desk.core.") : memoryStore(),
  ask: (prompt, tool) => (tool === "propose_theme" ? proposeTheme(prompt) : undefined),
  init: {
    profile: "morning",
    settings: {
      ...(params.has("reduced")
        ? { "desk.theme.motion": "reduce" }
        : { "desk.theme.motion": "full" }),
      ...JSON.parse(params.get("init") ?? "{}"),
    },
  },
});
// A fixed wall clock and platform, so "4:12 ago" and "⌘N" read the same on every machine.
const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const bridge = browserBridge({ now: () => clock.now(), epoch });
const lang = params.get("lang") === "en" ? "en" : "ko";
const desk = mountDesk({
  root,
  bridge,
  core: core.client,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  clock,
  epoch,
  platform: "mac",
  lang,
  seed: sampleState(lang, epoch),
});

/** Advance the clock in 16 ms frames, ending exactly at `ms` later. */
function step(ms: number): void {
  let left = ms;
  while (left > 0) {
    const d = Math.min(16, left);
    clock.advance(d);
    left -= d;
  }
}

window.__shell = {
  desk,
  clock,
  bridge,
  stub: core.stub,
  step,
  envelopes: { user: userHello as Envelope, eris: erisReply as Envelope },
};

if (params.has("studio")) {
  const previewed = params.get("studio") ?? "1";
  void desk.ready
    .then(() => desk.runtime.commands.run("desk.theme.studio"))
    .then(() => previewed !== "1" && desk.runtime.themes.preview(previewed));
}

if (params.has("edit")) {
  void desk.ready.then(() =>
    desk.runtime.commands.run("desk.theme.edit", { id: params.get("edit") }),
  );
}

if (params.has("describe")) {
  void desk.ready.then(() =>
    desk.runtime.commands.run("desk.theme.describe", { text: params.get("describe") }),
  );
}

if (params.has("say")) {
  void desk.ready.then(() => {
    const input = document.querySelector<HTMLInputElement>("#composer-input");
    if (!input) return;
    input.focus();
    input.value = params.get("say") ?? "";
    input.dispatchEvent(new Event("input"));
    // The last choice says it to Eris.
    for (const key of ["ArrowUp", "Enter"])
      input.dispatchEvent(new KeyboardEvent("keydown", { key }));
    step(1200);
  });
}
