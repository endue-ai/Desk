/// <reference types="vite/client" />
// The same invented notebook through the real plugin frame, Studio and the agent bar.
import type { PluginManifest, StubHandlers } from "@endue-ai/bridge";
import agents from "../../../../plugins/agents/plugin.json";
import workspace from "../../../../plugins/local-agents/plugin.json";
import "../../src/desk.css";
import "../../src/shell/styles";
import { browserBridge, browserCore, ManualClock, mountDesk } from "../../src/index";
import { pageWindowManager } from "./wm-host";

const params = new URLSearchParams(location.search);
const entry = params.get("entry");
const clock = new ManualClock(),
  epoch = Date.parse("2026-01-06T12:00:00Z");
const bridge = browserBridge({ epoch, now: () => clock.now(), localAgents: { stepMs: 0 } });
const local = bridge.localAgents;
if (!local) throw Error("Missing fixture bridge");
const [first, second, unrelated] = local.fixture.sessions;
if (!first || !second || !unrelated) throw Error("Missing fixture sessions");
first.title = "Review the outline";
second.title = "Check the captions";
unrelated.title = "Unrelated notebook";
first.cwd = "/sample/notebook";
first.model = "Writer";
first.branch = "outline-review";
second.cwd = first.cwd;
unrelated.cwd = "/other/notebook";
local.fixture.sessions.splice(0, local.fixture.sessions.length, first, second, unrelated);
const writer = local.fixture.agents[0];
if (!writer) throw Error("Missing fixture agent");
writer.name = "Writing agent";
local.fixture.messages[first.id] = [
  { role: "user", text: "Compare both outlines." },
  { role: "tool", name: "Read", text: "outline.txt" },
  { role: "tool", name: "Read", text: "captions.txt" },
  {
    role: "assistant",
    text: "## Summary\n\nBoth outlines cover the same three sections. The final heading is the only difference.\n\n- Keep the introduction and examples.\n- Rename the closing section to **Next steps**.\n\n![Outline](https://example.invalid/outline.png)\n\n```text\nIntroduction → Examples → Next steps\n```",
  },
];
local.fixture.messages[second.id] = [
  { role: "user", text: "Review the caption." },
  { role: "assistant", text: "Caption preview." },
];
if (params.has("long")) {
  const earlier = Array.from({ length: 260 }, (_, i) => ({
    role: "user" as const,
    text: `Notebook entry ${i + 1}`,
  }));
  local.fixture.messages[first.id] = [...earlier, ...(local.fixture.messages[first.id] ?? [])];
  first.title = "Review the outline · 긴 제목에서도 대화 내용을 읽을 수 있는지 확인";
  const assistant = local.fixture.messages[first.id]?.at(-1);
  if (assistant) assistant.text += "\n\n```text\n" + "example".repeat(140) + "\n```";
}
const policies = Object.values(
  import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
    eager: true,
    import: "default",
  }),
).filter((p) => p.kind === "policy" && p.id.startsWith("desk.") && p.id !== "desk.shell");
const handlers: StubHandlers = {
  "agents.list": async () => ({ agents: await local.list() }),
  "agents.sessions": ({ agent, ...options }) => local.sessions(agent, options),
  "agents.transcript": ({ agent, sessionId, limit }) => local.transcript(agent, sessionId, limit),
  "agents.runs": async () => ({ runs: await local.runs() }),
  "agents.ask": async (ask) => ({
    run: await local.ask({ ...ask, access: ask.access ?? "read-only" }),
  }),
};
const core = browserCore({
  manifests: [...policies, agents as PluginManifest, workspace as PluginManifest],
  handlers,
  init: {
    settings: {
      "desk.theme.scheme": params.get("scheme") ?? "light",
      "desk.theme.contrast": params.get("contrast") ?? "normal",
      "desk.theme.motion": "reduce",
    },
  },
  open: () => {},
});
const root = document.getElementById("desk");
if (!root) throw Error("Missing fixture root");
const plugins = {
  url: (id: string, path: string, revision?: string | number) =>
    `/plugins/${id}/${path}?v=${revision ?? ""}`,
};
const desk = mountDesk({
  root,
  bridge,
  core: core.client,
  plugins,
  clock,
  epoch,
  platform: "other",
  lang: "en",
  windowManager: await pageWindowManager(),
});
await desk.ready;
if (entry === "screen") {
  // A live reply from the stub goes through the same bridge events as a local run.
  if (params.has("long")) {
    const send = document.createElement("button");
    send.textContent = "Append fixture reply";
    send.style.position = "fixed";
    send.style.zIndex = "10000";
    send.onclick = () => {
      void local.ask({
        agent: first.agent,
        sessionId: first.id,
        prompt: "Another outline update",
        access: "read-only",
      });
    };
    document.body.append(send);
  }
} else {
  const runtime = desk.runtime;
  await runtime.plugins?.ready;
  const id = entry === "studio" ? "endue.agents" : "endue.local-agents";
  await runtime.commands.run("desk.plugins.open", { plugin: id });
}
