// Test page: endue.docs (plugins/docs) over the desk.* policies on the browser stub, with the plugin's
// own fixture document at ~/Documents/rich.docx (headings, a comment, a table, a picture), read
// through ranged fs.read as base64 (the frame's CSP lets no data: URL be fetched). Every permission
// the plugin asks for is granted, as the person would. Never shipped.
import type { PluginManifest, StubHandlers } from "@endue-ai/bridge";
import docsManifest from "../../../../plugins/docs/plugin.json";
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

// The fixture server serves the plugin's folder, its test fixtures too.
const rich = await fetch("/plugins/endue.docs/tests/fixtures/rich.docx");
const bytes = new Uint8Array(await rich.arrayBuffer());
const files: Record<string, Uint8Array> = { "~/Documents/rich.docx": bytes };
const handlers: StubHandlers = {
  "fs.url": () => {
    throw new Error("no URL in this fixture");
  },
  "fs.read": ({ path, offset = 0, length }) => {
    const file = files[path];
    if (!file) throw new Error(`No fixture ${path}`);
    const part = file.subarray(offset, length === undefined ? undefined : offset + length);
    let text = "";
    for (const byte of part) text += String.fromCharCode(byte);
    return { content: btoa(text), encoding: "base64", size: file.length };
  },
  "fs.watch": ({ path }) => ({ watchId: `watch:${path}` }),
};

const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, docsManifest as PluginManifest],
  handlers,
  open: () => {},
});
core.client.onEvent((event) => {
  if (event.event === "perm.prompt")
    void core.client.call("perm.answer", {
      promptId: event.data.promptId,
      granted: true,
      scope: { permission: "perm:manage" },
    });
});
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});

window.__desk = { clock, runtime, stub: core.stub, commands: [] };
