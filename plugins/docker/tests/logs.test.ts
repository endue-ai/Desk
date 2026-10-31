import { describe, expect, it } from "vitest";
import { createLogs, type LogModel, logArgs, matches, parseLine, readLogs } from "../ui/logs.js";
import type { Outcome, StreamOptions } from "../ui/run.js";

/** A runner whose streams the test drives by hand. */
function fakeRunner(outcome: Partial<Outcome> = {}) {
  const streams: Array<{ args: string[]; options: StreamOptions; stopped: boolean }> = [];
  const runs: Array<{ args: string[]; cwd?: string }> = [];
  return {
    streams,
    runs,
    run: async (args: string[], options: { cwd?: string } = {}) => {
      runs.push({ args, ...(options.cwd ? { cwd: options.cwd } : {}) });
      return { code: 0, signal: null, stdout: "", stderr: "", ...outcome };
    },
    stream: async (args: string[], options: StreamOptions) => {
      const entry = { args, options, stopped: false };
      streams.push(entry);
      return {
        procId: `s${streams.length}`,
        stop: async () => {
          if (entry.stopped) return;
          entry.stopped = true;
          options.onExit?.({ code: null, signal: "term", stdout: "", stderr: "" });
        },
      };
    },
  };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

function logs(limits = { tail: 100, max: 100 }) {
  const runner = fakeRunner();
  const models: LogModel[] = [];
  const app = createLogs({
    runner,
    onChange: (m) => models.push(m),
    limits: () => limits,
    flushMs: 0,
  });
  return { runner, models, app };
}

describe("logArgs", () => {
  it("reads a container's or a project's logs with times, a tail and a follow", () => {
    expect(
      logArgs({ kind: "container", id: "abc", name: "web" }, { tail: 50, follow: true }),
    ).toEqual(["logs", "--timestamps", "--tail", "50", "--follow", "--", "abc"]);
    expect(
      logArgs({ kind: "project", name: "shop" }, { tail: 10, follow: false, since: "10m" }),
    ).toEqual([
      "compose",
      "--ansi",
      "never",
      "-p",
      "shop",
      "logs",
      "--no-color",
      "--timestamps",
      "--tail",
      "10",
      "--since",
      "10m",
    ]);
  });
});

describe("parseLine and matches", () => {
  it("splits a project's service prefix and every line's time, and drops colours", () => {
    expect(
      parseLine("2026-10-31T06:08:53.944264217Z \u001b[32mready\u001b[0m", "stdout", false),
    ).toEqual({
      stream: "stdout",
      time: "2026-10-31T06:08:53.944264217Z",
      source: "",
      text: "ready",
    });
    expect(parseLine("web-1  | 2026-10-31T06:08:53Z GET / 200", "stdout", true)).toEqual({
      stream: "stdout",
      time: "2026-10-31T06:08:53Z",
      source: "web-1",
      text: "GET / 200",
    });
    expect(parseLine("a | b", "stderr", false)).toMatchObject({
      source: "",
      text: "a | b",
      time: "",
    });
  });

  it("matches every word in any case", () => {
    const line = {
      n: 0,
      stream: "stdout" as const,
      time: "",
      source: "web-1",
      text: "GET /health 200 OK",
    };
    expect(matches(line, "")).toBe(true);
    expect(matches(line, "get ok")).toBe(true);
    expect(matches(line, "WEB 200")).toBe(true);
    expect(matches(line, "500")).toBe(false);
  });
});

describe("createLogs", () => {
  it("follows a target's lines and says when the container stops", async () => {
    const { runner, models, app } = logs();
    await app.open({ kind: "container", id: "abc", name: "web" }, { follow: true });
    const { options } = runner.streams[0] ?? { options: undefined };
    options?.onLine("stdout", "2026-10-31T06:00:00Z one");
    options?.onLine("stderr", "2026-10-31T06:00:01Z two");
    await wait();
    expect(models.at(-1)).toMatchObject({ title: "docker logs: web", follow: true, running: true });
    expect(models.at(-1)?.lines.map((l) => `${l.stream}:${l.text}`)).toEqual([
      "stdout:one",
      "stderr:two",
    ]);
    options?.onExit?.({ code: 0, signal: null, stdout: "", stderr: "" });
    await wait();
    expect(models.at(-1)).toMatchObject({
      running: false,
      ended: "The container stopped: the logs end here.",
    });
  });

  it("keeps at most max lines and counts what dropped off the front", async () => {
    const { runner, models, app } = logs({ tail: 10, max: 100 });
    await app.open({ kind: "container", id: "abc", name: "web" }, { follow: true });
    for (let i = 0; i < 130; i++) runner.streams[0]?.options.onLine("stdout", `line ${i}`);
    await wait();
    const model = models.at(-1);
    expect(model?.lines.length).toBeLessThanOrEqual(116);
    expect((model?.first ?? 0) + (model?.lines.length ?? 0)).toBe(130);
    expect(model?.lines.at(-1)).toMatchObject({ n: 129, text: "line 129" });
  });

  it("stops the old stream when another target opens, and ignores its late lines", async () => {
    const { runner, models, app } = logs();
    await app.open({ kind: "container", id: "a", name: "a" }, { follow: true });
    await app.open({ kind: "project", name: "shop" }, { follow: true });
    expect(runner.streams[0]?.stopped).toBe(true);
    expect(runner.streams[1]?.options.cwd).toBe("/");
    runner.streams[0]?.options.onLine("stdout", "late");
    runner.streams[1]?.options.onLine("stdout", "web-1  | fresh");
    await wait();
    expect(models.at(-1)?.lines.map((l) => l.text)).toEqual(["fresh"]);
    expect(models.at(-1)?.generation).toBe(2);
  });

  it("stops following on request, follows again from the tail, and clears", async () => {
    const { runner, models, app } = logs();
    await app.open({ kind: "container", id: "a", name: "a" }, { follow: true });
    runner.streams[0]?.options.onLine("stdout", "x");
    await app.setFollow(false);
    expect(runner.streams[0]?.stopped).toBe(true);
    expect(models.at(-1)).toMatchObject({
      follow: false,
      running: false,
      ended: "Stopped following.",
    });
    await app.setFollow(true);
    expect(runner.streams).toHaveLength(2);
    expect(runner.streams[1]?.args).toContain("--follow");
    runner.streams[1]?.options.onLine("stdout", "y");
    await wait();
    app.clear();
    expect(models.at(-1)).toMatchObject({ lines: [], first: 1 });
  });

  it("says what docker said when the logs cannot be read", async () => {
    const { runner, models, app } = logs();
    await app.open({ kind: "container", id: "gone", name: "gone" }, { follow: false });
    runner.streams[0]?.options.onExit?.({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "Error response from daemon: No such container: gone",
    });
    await wait();
    expect(models.at(-1)?.ended).toBe("No such container: gone");
    await expect(
      createLogs({
        runner: { ...runner, stream: async () => Promise.reject(new Error("nope")) },
        onChange: () => {},
        limits: () => ({ tail: 1, max: 100 }),
      }).open({ kind: "container", id: "a", name: "a" }, { follow: true }),
    ).rejects.toThrow("nope");
  });
});

describe("readLogs", () => {
  it("reads both streams once and puts them in time order", async () => {
    const runner = fakeRunner({
      stdout: "2026-10-31T06:00:00Z a\n2026-10-31T06:00:02Z c\n",
      stderr: "2026-10-31T06:00:01Z b\n",
    });
    const lines = await readLogs(runner, { kind: "project", name: "shop" }, { tail: 3 });
    expect(lines.map((l) => `${l.stream}:${l.text}`)).toEqual(["stdout:a", "stderr:b", "stdout:c"]);
    expect(runner.runs[0]).toMatchObject({ cwd: "/" });
    expect(runner.runs[0]?.args).not.toContain("--follow");
  });
});
