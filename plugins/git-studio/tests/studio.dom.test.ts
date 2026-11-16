// @vitest-environment jsdom
// The whole window on a real repository: the page as the desk serves it, mounted with a bridge
// whose proc.spawn runs the real git, so the graph, the sidebar, the working copy panel and the
// commands are checked end to end.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFeatures } from "../ui/features.js";
import { createStudio } from "../ui/studio.js";
import { tempRepo } from "./real-git";

type Listener = (event: { event: string; data: Record<string, unknown> }) => void;

function realBridge() {
  const listeners = new Set<Listener>();
  const emit: Listener = (event) => {
    for (const l of listeners) l(event);
  };
  const inputs = new Map<string, string>();
  let next = 0;
  return {
    onEvent: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === "proc.write") {
        inputs.set(String(params.procId), String(params.data));
        return {};
      }
      if (method !== "proc.spawn") throw Object.assign(new Error(method), { code: "unsupported" });
      const procId = `p${++next}`;
      setTimeout(() => {
        const child = execFile(
          "git",
          params.args as string[],
          {
            cwd: params.cwd as string,
            env: { ...process.env, ...(params.env as object), GIT_CONFIG_GLOBAL: "/dev/null" },
            encoding: "buffer",
            maxBuffer: 8 << 20,
          },
          (error, stdout, stderr) => {
            const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
            if (stdout.length)
              emit({
                event: "proc.output",
                data: {
                  procId,
                  stream: "stdout",
                  data: stdout.toString("base64"),
                  encoding: "base64",
                },
              });
            if (stderr.length)
              emit({
                event: "proc.output",
                data: {
                  procId,
                  stream: "stderr",
                  data: stderr.toString("base64"),
                  encoding: "base64",
                },
              });
            emit({ event: "proc.exit", data: { procId, code, signal: null } });
          },
        );
        child.stdin?.end(inputs.get(procId) ?? "");
      }, 0);
      return { procId };
    },
  };
}

let repo: Awaited<ReturnType<typeof tempRepo>>;
beforeEach(async () => {
  repo = await tempRepo();
  await repo.git("switch", "-q", "-c", "topic");
  repo.write("b.txt", "b\n");
  await repo.git("add", "b.txt");
  await repo.git("commit", "-q", "-m", "On topic");
  await repo.git("switch", "-q", "main");
  await repo.git("merge", "-q", "--no-ff", "-m", "Merge topic", "topic");
  repo.write("a.txt", "changed\n");
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => repo.done());

async function mount() {
  const handlers = new Map<string, (args: unknown) => unknown>();
  let kept: unknown = { repo: repo.root };
  const ctx = {
    bridge: realBridge(),
    state: { get: () => kept, set: (v: unknown) => (kept = v) },
    commands: {
      on: (name: string, h: (args: unknown) => unknown) => handlers.set(name, h),
      run: async () => undefined,
    },
  };
  const studio = createStudio(ctx as never, document);
  installFeatures(studio, ctx as never);
  await vi.waitFor(() => expect(studio.app.get().snapshot).not.toBeNull(), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 50));
  return { studio, handlers };
}

describe("the window on a real repository", () => {
  it("draws the graph with its lanes, the WIP row, the sidebar and the working copy", async () => {
    const { studio } = await mount();
    const rows = [...document.querySelectorAll(".graph-row")];
    expect(rows[0]?.classList.contains("is-wip")).toBe(true);
    expect(rows.map((r) => r.querySelector(".message-text")?.textContent).filter(Boolean)).toEqual([
      "Merge topic",
      "On topic",
      "First",
    ]);
    expect(
      document.querySelector(".graph-row.is-head .ref-pill.is-current")?.textContent,
    ).toContain("main");
    expect(document.querySelectorAll(".lanes path").length).toBeGreaterThan(3);
    const names = [...document.querySelectorAll(".side-ref .side-name")].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(["main", "topic"]));
    expect(studio.app.get().selected).toBe("~wip");
    expect((document.getElementById("wip") as HTMLElement).hidden).toBe(false);
    expect(document.querySelector(".wip-row .file-base")?.textContent).toBe("a.txt");
  });

  it("answers endue.git-studio.state and commits through endue.git-studio.commit", async () => {
    const { handlers } = await mount();
    const state = (await handlers.get("endue.git-studio.state")?.({})) as Record<string, unknown>;
    expect(state).toMatchObject({ branch: "main", changes: 1, operation: null });
    expect((state.unstaged as unknown[]).length).toBe(1);
    await expect(
      handlers.get("endue.git-studio.commit")?.({ message: "Nothing staged" }),
    ).rejects.toThrow(/Nothing is staged/);
    const done = (await handlers.get("endue.git-studio.commit")?.({
      message: "Change a",
      all: true,
    })) as { committed: string };
    expect(done.committed).toMatch(/^[0-9a-f]{40}$/);
    const subject = (await repo.git("log", "-1", "--format=%s")).stdout.trim();
    expect(subject).toBe("Change a");
  });
});
