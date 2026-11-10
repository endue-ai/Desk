/// <reference types="vite/client" />
// Test page: endue.agents (plugins/agents) over the desk.* policies on the browser stub. studio.*
// is the shared stub (src/bridge/studio.ts): Miso, Mailie and Scout with the Home board's
// conversations and three catalog agents, timed from the fixtures' clock. agents.* answers with two
// local agents from the plugin's own fixtures (Claude Code, which runs; Codex, sessions only), and
// agents.ask streams a short reply as agents.run steps. Never shipped.
//   ?signedout=1   the desk is not signed in to endue ID: every studio.* call is signed_out
import {
  type LocalAgentRun,
  type PluginManifest,
  StubError,
  type StubHandlers,
} from "@endue-ai/bridge";
import agentsManifest from "../../../../plugins/agents/plugin.json";
import {
  localAgents,
  localSessions,
  NOW,
  run,
  transcript,
} from "../../../../plugins/agents/tests/fixtures";
import "../../src/desk.css";
import { browserCore } from "../../src/bridge/core";
import { studioHandlers } from "../../src/bridge/studio";
import { createRuntime, ManualClock } from "../../src/index";

const params = new URLSearchParams(location.search);
const manifests = import.meta.glob<PluginManifest>("../../../../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});
const policies = Object.values(manifests).filter(
  (m) => m.id.startsWith("desk.") && m.id !== "desk.shell" && m.kind === "policy",
);

const sessions = localSessions();
let runs = 0;
const local: StubHandlers = {
  "agents.list": () => ({ agents: localAgents() }),
  "agents.runs": () => ({ runs: [] }),
  "agents.sessions": ({ agent, limit = 50 }) => {
    const all = sessions[agent] ?? [];
    return { sessions: all.slice(0, limit), total: all.length };
  },
  "agents.transcript": ({ agent, sessionId }) => {
    const session = (sessions[agent] ?? []).find((s) => s.id === sessionId);
    if (!session) throw new StubError("not_found", "no such session");
    return { session, messages: transcript(), truncated: false };
  },
  // A run that answers in two blocks and ends, as the core streams agents.run.
  "agents.ask": ({ agent, prompt, access, sessionId }) => {
    const started: LocalAgentRun = run({
      runId: `run-${++runs}`,
      agent,
      prompt,
      access: access ?? "read-only",
      ...(sessionId ? { sessionId } : {}),
    });
    // The core addresses agents.run to the holders of agents:manage: here, the plugin.
    const step = (data: object, after: number) =>
      setTimeout(
        () =>
          core.stub.emit({
            event: "agents.run",
            data: { runId: started.runId, agent, ...data },
            to: ["endue.agents"],
          } as never),
        after,
      );
    step({ kind: "text", text: "The bridge carries every call **under a scope**." }, 20);
    step({ kind: "tool", tool: "Read", detail: "specs/bridge/v0/agents.schema.json" }, 40);
    step({ kind: "text", text: "Nothing changes without one." }, 60);
    const done = { ...started, state: "done", sessionId: sessionId ?? "s-new", text: "Done." };
    step({ kind: "done", run: done }, 80);
    return { run: started };
  },
  "agents.stop": ({ runId }) => ({ run: run({ runId, state: "stopped" }) }),
};

const studio = studioHandlers({ epoch: NOW, signedIn: !params.has("signedout") });
const clock = new ManualClock();
const core = browserCore({
  manifests: [...policies, agentsManifest as PluginManifest],
  handlers: { ...local, ...studio.handlers },
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
