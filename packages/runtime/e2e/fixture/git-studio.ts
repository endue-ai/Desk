import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import manifest from "../../../../plugins/git-studio/plugin.json";
import theme from "../../../../plugins/theme/plugin.json";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const github = !new URLSearchParams(location.search).has("gitlab");
const host = github ? "github.com" : "gitlab.com";
const web = `https://${host}/demo/studio`;
const sha = "a".repeat(40);
const calls: string[] = [];
const clock = new ManualClock();
let next = 0;
let merged = false;
let emit: (event: BridgeEvent) => void = () => {};

function request(number: number, source: string, target: string) {
  const title = number === 1 ? "Prepare topic" : "Integrate topic";
  const state = number === 1 && merged ? "merged" : "opened";
  return github
    ? {
        number,
        title,
        state: state === "merged" ? "closed" : "open",
        merged_at: state === "merged" ? "2026-11-27T03:00:00Z" : null,
        head: { sha, ref: source, repo: { full_name: "demo/studio" } },
        base: { ref: target, repo: { full_name: "demo/studio" } },
        html_url: `${web}/pull/${number}`,
        user: { login: "demo" },
      }
    : {
        iid: number,
        title,
        state,
        sha,
        source_branch: source,
        target_branch: target,
        source_project_id: 3,
        target_project_id: 3,
        web_url: `${web}/-/merge_requests/${number}`,
        author: { username: "demo" },
      };
}

function response(endpoint: string) {
  if (/\/(?:pulls|merge_requests)\/1\/merge$/.test(endpoint)) {
    merged = true;
    return { merged: true, state: "merged" };
  }
  if (/\/(?:pulls|merge_requests)\/1$/.test(endpoint)) return request(1, "feature/a", "feature/b");
  if (/\/(?:pulls|merge_requests)\?/.test(endpoint))
    return [
      ...(!merged || endpoint.includes("state=all") ? [request(1, "feature/a", "feature/b")] : []),
      request(2, "feature/b", "main"),
    ];
  if (/\/jobs\?/.test(endpoint)) {
    const job = {
      id: 12,
      name: "Compile packages",
      stage: "build",
      status: "failed",
      conclusion: "failure",
      started_at: "2026-11-27T03:00:00Z",
      finished_at: "2026-11-27T03:01:12Z",
      web_url: `${web}/-/jobs/12`,
      html_url: `${web}/actions/runs/7/job/12`,
    };
    return github ? { jobs: [job], total_count: 1 } : [job];
  }
  if (/\/(?:runs|pipelines)\?/.test(endpoint)) {
    const run = { id: 7, status: "failed", ref: "main", sha, web_url: `${web}/-/pipelines/7` };
    return github
      ? {
          workflow_runs: [
            {
              ...run,
              name: "Desktop CI",
              head_branch: "main",
              run_attempt: 2,
              html_url: `${web}/actions/runs/7`,
            },
          ],
        }
      : [run];
  }
  return [
    {
      id: 9,
      tag_name: "v1.2.0",
      name: "November release",
      html_url: `${web}/releases/tag/v1.2.0`,
      _links: { self: `${web}/-/releases/v1.2.0` },
    },
  ];
}

const core = browserCore({
  manifests: [theme, manifest] as PluginManifest[],
  store: memoryStore(),
  handlers: {
    "proc.spawn": ({ command, args = [], cwd }) => {
      const procId = `p-${++next}`;
      let data = "";
      let code = 0;
      const git = args.slice(5);
      if (command === "git") {
        if (git[1] === "--show-toplevel") data = `${cwd}\n`;
        else if (git[0] === "rev-parse") code = 1;
        else if (git[0] === "status") data = "# branch.oid (initial)\0# branch.head feature/a\0";
        else if (git[0] === "remote")
          data = git[1] === "get-url" ? `${web}.git\n` : `origin\t${web}.git (fetch)\n`;
      } else {
        calls.push(`${command} ${args.join(" ")}`);
        data = JSON.stringify(response(args[5] ?? ""));
      }
      const finish = () => {
        if (data)
          emit({
            event: "proc.output",
            data: { procId, stream: "stdout", data, encoding: "utf8" },
          });
        emit({ event: "proc.exit", data: { procId, code } });
      };
      if (args.includes("--input")) {
        waitForInput.set(procId, finish);
      } else {
        setTimeout(finish, 0);
      }
      return { procId };
    },
    "proc.write": ({ procId, data }) => {
      calls.push(data);
      const finish = waitForInput.get(procId);
      waitForInput.delete(procId);
      if (finish) setTimeout(finish, 0);
      return {};
    },
    "proc.kill": () => ({}),
  },
});
const waitForInput = new Map<string, () => void>();
emit = (event) => core.stub.emit(event);
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});
window.__desk = { clock, runtime, stub: core.stub, commands: calls };
