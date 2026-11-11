// Test page: endue.memory (plugins/memory) over the desk.* policies on the browser stub, with
// memory.* answered from the plugin's own fixtures (two facts and a conversation). Never shipped.
//   ?long=1   a conversation of about 260 words is the newest entry
import type { PluginManifest } from "@endue-ai/bridge";
import memoryManifest from "../../../../plugins/memory/plugin.json";
import { fixture, longEpisode, memoryHandlers } from "../../../../plugins/memory/tests/fixtures";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const params = new URLSearchParams(location.search);
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const entries = params.has("long") ? [...fixture(), longEpisode()] : fixture();
const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, memoryManifest as PluginManifest],
  handlers: memoryHandlers(entries),
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
