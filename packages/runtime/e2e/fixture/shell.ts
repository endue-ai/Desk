/// <reference types="vite/client" />
// Test page: the desk shell on the browser bridge stubs (the core's and the shell's), a manual clock
// and in-memory storage. ?lang=en, ?persist=1 (the core's store in localStorage), ?reduced=1
// (desk.theme.motion: reduce), ?init={...} (more init.yaml settings). Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import "../../src/shell/styles";
import { browserBridge, type Envelope } from "../../src/bridge/browser";
import { browserCore, localStore, memoryStore } from "../../src/bridge/core";
import erisReply from "../../src/bridge/envelopes/eris-reply.json";
import userHello from "../../src/bridge/envelopes/user-hello.json";
import { ManualClock } from "../../src/clock";
import { mountDesk } from "../../src/shell/Desk";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const params = new URLSearchParams(location.search);
const clock = new ManualClock();
// The desk.* policies (the shell's own included) and the palette: the plugin chrome the shell
// replaces (dock, toolbar, sidebar) is not installed here.
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const core = browserCore({
  manifests: Object.values(manifests).filter((m) => m.id.startsWith("desk.")),
  store: params.has("persist") ? localStore("desk.core.") : memoryStore(),
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
const desk = mountDesk({
  root,
  bridge,
  core: core.client,
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  clock,
  epoch,
  platform: "mac",
  lang: params.get("lang") === "en" ? "en" : "ko",
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
  step,
  envelopes: { user: userHello as Envelope, eris: erisReply as Envelope },
};
