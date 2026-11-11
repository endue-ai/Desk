// Test page: endue.images (plugins/images) over the desk.* policies on the browser stub, with the
// image fixtures of file-viewers.ts as files, in the frame a plugin page gets. Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import imagesManifest from "../../../../plugins/images/plugin.json";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";
import { fileHandlers } from "./file-viewers";

const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, imagesManifest as PluginManifest],
  handlers: fileHandlers,
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
