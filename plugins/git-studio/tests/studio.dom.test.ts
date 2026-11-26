// @vitest-environment jsdom
// The whole window on a real repository: the page as the desk serves it, mounted with a bridge
// whose proc.spawn runs the real git, so the graph, the sidebar, the working copy panel and the
// commands are checked end to end.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Invocation } from "@endue-ai/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFeatures } from "../ui/features.js";
import { createStudio } from "../ui/studio.js";
import { gitOutput, realGit, tempRepo } from "./real-git";

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
      setTimeout(async () => {
        const input = inputs.get(procId);
        inputs.delete(procId);
        const { code, stdout, stderr } = await gitOutput(params.args as string[], {
          cwd: params.cwd as string,
          env: { ...process.env, ...(params.env as NodeJS.ProcessEnv) },
          input,
        }).catch((error: Error) => ({
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(error.message),
        }));
        for (const [stream, bytes] of [
          ["stdout", stdout],
          ["stderr", stderr],
        ] as const) {
          if (bytes.length)
            emit({
              event: "proc.output",
              data: { procId, stream, data: bytes.toString("base64"), encoding: "base64" },
            });
        }
        emit({ event: "proc.exit", data: { procId, code, signal: null } });
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
  type Handler = (args: unknown, invocation?: Invocation) => unknown;
  const handlers = new Map<string, Handler>();
  let kept: unknown = { repo: repo.root };
  const ctx = {
    bridge: realBridge(),
    state: { get: () => kept, set: (v: unknown) => (kept = v) },
    commands: {
      on: (name: string, h: Handler) => handlers.set(name, h),
      run: async () => undefined,
    },
  };
  const studio = createStudio(ctx as never, document);
  installFeatures(studio, ctx as never);
  await vi.waitFor(() => expect(studio.app.get().snapshot).not.toBeNull(), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 50));
  const agent = async (name: string, args: object = {}) => {
    const handler = handlers.get(`endue.git-studio.${name}`);
    if (!handler) throw new Error(`Git Studio has no ${name} handler`);
    return handler(args, { caller: "agent:fixture", invocationId: "fixture" });
  };
  return { studio, handlers, agent };
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
    expect(state).toMatchObject({ branchCount: 2, tagCount: 0 });
    expect((state.branches as { name: string }[]).map((b) => b.name)).toEqual(["main", "topic"]);
    await expect(
      handlers.get("endue.git-studio.commit")?.({ message: "Nothing staged" }),
    ).rejects.toThrow(/Nothing is staged/);
    const done = (await handlers.get("endue.git-studio.commit")?.({
      message: "Change a",
      all: true,
    })) as { committed: string };
    expect(done.committed).toMatch(/^[0-9a-f]{40}$/);
    const commit = await repo.git("log", "-1", "--format=%s%n%an <%ae>%n%cn <%ce>");
    expect(commit.stdout.trim().split("\n")).toEqual([
      "Change a",
      "endue-team <team@endue.ai>",
      "endue-team <team@endue.ai>",
    ]);
  });

  it("keeps endue.git-studio.state short in a repository of many branches", async () => {
    const head = (await repo.git("rev-parse", "HEAD")).stdout.trim();
    const names = Array.from({ length: 400 }, (_, i) => `ai/${i}-a-branch-with-a-long-name`);
    const refs = names.map((name) => `create refs/heads/${name} ${head}\n`).join("");
    await realGit.run(["update-ref", "--stdin"], { cwd: repo.root, input: refs });
    const { handlers } = await mount();
    const state = (await handlers.get("endue.git-studio.state")?.({})) as {
      branchCount: number;
      branches: { name: string; current: boolean }[];
      recent: { subject: string }[];
    };
    expect(state.branchCount).toBe(402);
    expect(state.branches).toHaveLength(30);
    expect(state.branches[0]).toMatchObject({ name: "main", current: true });
    // The latest commits come before the lists, and the whole answer fits what a brain keeps.
    const text = JSON.stringify(state);
    expect(text.indexOf('"recent"')).toBeLessThan(text.indexOf('"branches"'));
    expect(text.length).toBeLessThan(8000);
    expect(state.recent.map((c) => c.subject)).toEqual(["Merge topic", "On topic", "First"]);
  });

  it("finds commits as data through endue.git-studio.log", async () => {
    const commit = async (file: string, message: string) => {
      repo.write(file, `${message}\n`);
      await repo.git("add", "-A");
      await repo.git("commit", "-q", "-m", message);
    };
    await commit("p.txt", "fix(perf): the gate grips the title bar");
    await repo.git("switch", "-q", "topic");
    await commit("q.txt", "Fix(Perf): on another branch");
    await commit("r.txt", "fix: not the one");
    await repo.git("switch", "-q", "main");
    const { handlers } = await mount();
    type Found = { commits: { sha: string; subject: string; author: string }[]; more: boolean };
    const log = (args: object) => handlers.get("endue.git-studio.log")?.(args) as Promise<Found>;

    const perf = await log({ query: "fix(perf)" });
    expect(perf.commits.map((c) => c.subject).sort()).toEqual([
      "Fix(Perf): on another branch",
      "fix(perf): the gate grips the title bar",
    ]);
    expect(perf.commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(perf.more).toBe(false);

    const one = await log({ limit: 1 });
    expect(one).toMatchObject({ more: true });
    expect(one.commits).toHaveLength(1);
    const byPath = await log({ query: "q.txt", mode: "path" });
    expect(byPath.commits.map((c) => c.subject)).toEqual(["Fix(Perf): on another branch"]);
    const byCode = await log({ query: "not the one", mode: "code" });
    expect(byCode.commits.map((c) => c.subject)).toEqual(["fix: not the one"]);
    expect((await log({ query: "fix", author: "nobody" })).commits).toEqual([]);
  });

  it("lets an agent open Git Studio and read changes, commits, blame and file history", async () => {
    const { studio, agent } = await mount();
    const head = (await repo.git("rev-parse", "HEAD")).stdout.trim();
    const root = studio.app.get().repo;
    expect(await agent("open", { path: repo.root })).toEqual({ opened: root });
    expect(await agent("diff", { path: "a.txt" })).toMatchObject({
      text: expect.stringContaining("+changed"),
    });
    await repo.git("add", "a.txt");
    expect(await agent("diff", { path: "a.txt", staged: true })).toMatchObject({
      text: expect.stringContaining("+changed"),
    });
    expect(await agent("diff", { sha: head })).toMatchObject({
      text: expect.stringContaining("+b"),
    });
    const detail = await agent("show", { sha: head });
    expect(detail).toMatchObject({ sha: head, summary: "Merge topic" });
    expect(detail).not.toHaveProperty("email");
    expect(await agent("blame-data", { path: "b.txt" })).toMatchObject({
      lines: [expect.objectContaining({ line: 1, text: "b" })],
    });
    expect(await agent("file-log", { path: "b.txt" })).toMatchObject({
      commits: [expect.objectContaining({ subject: "On topic" })],
    });
    expect(studio.app.get().center).toBe("graph");
  });

  it("takes an explicit first push and reports rejection and divergence without a dialog", async () => {
    const remote = join(repo.root, "upstream.git");
    await repo.git("init", "--bare", "-q", remote);
    await repo.git("remote", "add", "origin", remote);
    const { studio, agent } = await mount();
    const first = agent("push", { remote: "origin" });
    void first.catch(() => {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await expect(first).resolves.toMatchObject({ ok: true });
    expect((await repo.git("rev-parse", "--abbrev-ref", "@{u}")).stdout.trim()).toBe("origin/main");
    await repo.git("switch", "-q", "-c", "advanced");
    await repo.git("commit", "--allow-empty", "-q", "-m", "Remote change");
    await repo.git("push", "origin", "HEAD:refs/heads/main");
    await repo.git("switch", "-q", "main");
    await repo.git("commit", "--allow-empty", "-q", "-m", "Local change");
    await studio.app.refresh();
    await expect(agent("push")).rejects.toThrow(/pull first/i);
    await expect(agent("pull")).rejects.toThrow(/fast-forward/i);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await expect(agent("pull", { strategy: "merge" })).resolves.toMatchObject({ ok: true });
    expect((await repo.git("rev-list", "--count", "HEAD..origin/main")).stdout.trim()).toBe("0");
  });

  it("applies stash and index operations and protects the explicit destructive target", async () => {
    const { studio, agent } = await mount();
    const root = studio.app.get().repo;
    const sha = (await repo.git("rev-parse", "HEAD")).stdout.trim();
    await repo.git("add", "a.txt");
    await expect(agent("unstage", { paths: ["a.txt"] })).resolves.toMatchObject({ ok: true });
    expect((await repo.git("diff", "--cached", "--name-only")).stdout).toBe("");
    await expect(agent("stash", { message: "Keep the change" })).resolves.toMatchObject({
      ok: true,
    });
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("one\n");
    await agent("stash-apply", { index: 0 });
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("changed\n");
    await expect(agent("discard", { root: "different", paths: ["a.txt"] })).rejects.toThrow(
      /repository/i,
    );
    await expect(agent("reset", { sha, mode: "hard" })).rejects.toThrow(/hard reset/i);
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("changed\n");
    await expect(agent("reset-hard", { root, sha })).resolves.toMatchObject({ ok: true });
    const stash = (await repo.git("rev-parse", "refs/stash")).stdout.trim();
    await expect(agent("drop-stash", { root, index: 0, sha })).rejects.toThrow(/stash changed/i);
    await expect(agent("drop-stash", { root, index: 0, sha: stash })).resolves.toMatchObject({
      ok: true,
    });
    expect((await repo.git("stash", "list")).stdout).toBe("");
  });

  it("runs branch and tag operations and reflog undo on the real repository", async () => {
    const { agent } = await mount();
    const root = (await agent("state")) as { root: string };
    await agent("rename-branch", { from: "topic", to: "renamed" });
    expect((await repo.git("branch", "--list", "renamed")).stdout).toContain("renamed");
    await agent("tag", { name: "studio-test", sha: "HEAD" });
    expect((await repo.git("tag", "--list")).stdout.trim()).toBe("studio-test");
    await agent("delete-branch", { root: root.root, name: "renamed" });
    expect((await repo.git("branch", "--list", "renamed")).stdout).toBe("");
    const sha = (await repo.git("rev-parse", "HEAD")).stdout.trim();
    await repo.git("commit", "-q", "--allow-empty", "-m", "Undo me");
    await expect(agent("undo")).resolves.toMatchObject({ head: sha });
    expect(readFileSync(join(repo.root, "a.txt"), "utf8")).toBe("changed\n");
  });
});
