// Test page: endue.mail (plugins/mail) over the desk.* policies on the browser stub, with the stub's
// own fixture index and no mail account connected, as the desk is before a connector is set up.
// Never shipped.
import type { PluginManifest } from "@endue-ai/bridge";
import mailManifest from "../../../../plugins/mail/plugin.json";
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

const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, mailManifest as PluginManifest],
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
