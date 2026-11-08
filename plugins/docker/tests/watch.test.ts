import { describe, expect, it } from "vitest";
import { parseEvent } from "../ui/parse-engine.js";
import { DockerError, type StreamOptions } from "../ui/run.js";
import { createAlerts, createWatcher, EVENT_ARGS, type WatchState } from "../ui/watch.js";
import { DB_ID, event, WEB_ID } from "./fixtures";
import { fakeClock } from "./harness";

const wait = () => new Promise((resolve) => setTimeout(resolve, 2));

/** A runner whose event streams the test ends by hand; `fail` makes the next starts throw. */
function streams() {
  const started: Array<{ options: StreamOptions; stopped: boolean }> = [];
  const failures: Error[] = [];
  return {
    started,
    failures,
    stream: async (_args: string[], options: StreamOptions) => {
      const failure = failures.shift();
      if (failure) throw failure;
      const entry = { options, stopped: false };
      started.push(entry);
      return {
        procId: `e${started.length}`,
        stop: async () => {
          entry.stopped = true;
        },
      };
    },
  };
}

describe("createWatcher", () => {
  it("follows container, image, volume and network events and hands them on", async () => {
    const runner = streams();
    const seen: string[] = [];
    const states: WatchState[] = [];
    const watcher = createWatcher({
      runner,
      clock: fakeClock(),
      onEvent: (e) => seen.push(`${e.type}:${e.action}`),
      onState: (s) => states.push(s),
    });
    watcher.start();
    watcher.start();
    await wait();
    expect(runner.started).toHaveLength(1);
    expect(EVENT_ARGS).toEqual([
      "events",
      "--format",
      "{{json .}}",
      "--filter",
      "type=container",
      "--filter",
      "type=image",
      "--filter",
      "type=volume",
      "--filter",
      "type=network",
    ]);
    runner.started[0]?.options.onLine("stdout", event("container", "start", WEB_ID));
    runner.started[0]?.options.onLine("stdout", "not json");
    runner.started[0]?.options.onLine("stderr", event("image", "pull", "x"));
    expect(seen).toEqual(["container:start"]);
    expect(states).toEqual(["watching"]);
    expect(watcher.watching()).toBe(true);
  });

  it("starts again after 1, 2, 4 … seconds when the stream ends, and stops on a final failure", async () => {
    const runner = streams();
    const clock = fakeClock();
    const states: string[] = [];
    const watcher = createWatcher({
      runner,
      clock,
      onEvent: () => {},
      onState: (s, m) => states.push(`${s}:${m}`),
    });
    watcher.start();
    await wait();
    runner.started[0]?.options.onExit?.({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "daemon went away",
    });
    expect(states.at(-1)).toBe("retrying:daemon went away");
    runner.failures.push(new Error("still down"));
    clock.advance(999);
    await wait();
    expect(runner.started).toHaveLength(1);
    clock.advance(1);
    await wait();
    expect(states.at(-1)).toBe("retrying:still down");
    clock.advance(2000);
    await wait();
    expect(runner.started).toHaveLength(2);
    expect(states.at(-1)).toBe("watching:");
    // It ended at once, so the waits go on growing; after a long healthy run they start over.
    runner.started[1]?.options.onExit?.({ code: 1, signal: null, stdout: "", stderr: "" });
    clock.advance(4000);
    await wait();
    expect(runner.started).toHaveLength(3);
    clock.advance(30_000);
    runner.started[2]?.options.onExit?.({ code: 1, signal: null, stdout: "", stderr: "" });
    runner.failures.push(
      new DockerError("The docker program is not on PATH.", { kind: "missing" }),
    );
    clock.advance(1000);
    await wait();
    expect(states.at(-1)).toBe("stopped:The docker program is not on PATH.");
    expect(clock.pending()).toBe(0);
  });

  it("ends the stream on stop and does not start again", async () => {
    const runner = streams();
    const clock = fakeClock();
    const watcher = createWatcher({ runner, clock, onEvent: () => {} });
    watcher.start();
    await wait();
    await watcher.stop();
    expect(runner.started[0]?.stopped).toBe(true);
    runner.started[0]?.options.onExit?.({ code: null, signal: "term", stdout: "", stderr: "" });
    clock.advance(60_000);
    await wait();
    expect(runner.started).toHaveLength(1);
    expect(watcher.watching()).toBe(false);
  });
});

describe("createAlerts", () => {
  const setup = (mode: "failures" | "none" = "failures") => {
    const clock = fakeClock();
    const told: string[] = [];
    const alerts = createAlerts({
      notify: (a) => told.push(`${a.level}:${a.title}`),
      mode: () => mode,
      now: clock.now,
    });
    const feed = (action: string, id: string, attributes: Record<string, string> = {}) => {
      const parsed = parseEvent(event("container", action, id, attributes));
      if (!parsed) throw new Error("bad event");
      return alerts.feed(parsed);
    };
    return { clock, told, alerts, feed };
  };

  it("tells about a container that failed on its own, ran out of memory or went unhealthy", () => {
    const { told, feed } = setup();
    feed("die", WEB_ID, { exitCode: "1" });
    feed("oom", DB_ID, { name: "shop-db-1" });
    feed("health_status: unhealthy", DB_ID, { name: "shop-db-1" });
    feed("health_status: healthy", DB_ID);
    feed("die", DB_ID, { exitCode: "0" });
    expect(told).toEqual([
      "warning:shop-web-1 stopped with exit code 1",
      "error:shop-db-1 ran out of memory",
      "warning:shop-db-1 is unhealthy",
    ]);
  });

  it("stays quiet about exits someone asked for, and repeats itself at most once a minute", () => {
    const { told, feed, alerts, clock } = setup();
    feed("kill", WEB_ID, { signal: "15" });
    feed("die", WEB_ID, { exitCode: "143" });
    alerts.expect(DB_ID);
    feed("die", DB_ID, { exitCode: "137" });
    alerts.expect("worker-1");
    feed("die", "f".repeat(64), { exitCode: "1", name: "worker-1" });
    expect(told).toEqual([]);
    clock.advance(61_000);
    feed("die", WEB_ID, { exitCode: "1" });
    feed("die", WEB_ID, { exitCode: "1" });
    expect(told).toHaveLength(1);
    clock.advance(61_000);
    feed("die", WEB_ID, { exitCode: "1" });
    expect(told).toHaveLength(2);
    feed("destroy", WEB_ID);
  });

  it("says nothing when the setting says none", () => {
    const { told, feed } = setup("none");
    feed("oom", WEB_ID);
    feed("die", WEB_ID, { exitCode: "2" });
    expect(told).toEqual([]);
  });
});
