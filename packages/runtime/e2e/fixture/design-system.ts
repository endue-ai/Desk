// The real Notes page and default themes, on the browser core with no personal files.
import type { PluginManifest } from "@endue-ai/bridge";
import "../../src/desk.css";
import notes from "../../../../plugins/notes/plugin.json";
import theme from "../../../../plugins/theme/plugin.json";
import { browserCore, memoryStore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";
import tiles from "../themes/test-theme/plugin.json";

const clock = new ManualClock();
const core = browserCore({
  manifests: [theme, notes, tiles] as PluginManifest[],
  store: memoryStore(),
  init: { settings: { "desk.theme.scheme": "dark", "desk.theme.motion": "full" } },
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  storage: window.localStorage,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});
window.__desk = { clock, runtime, stub: core.stub, commands: [] };
