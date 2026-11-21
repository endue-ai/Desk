// @vitest-environment jsdom
// A plugin page the CEF shell loaded again by itself (#378): it stopped painting, and the shell's
// stall revive loaded it in its browser (`web_host/revive.rs`, #157) without the runtime, so the
// shell says so (`desk://frame-reloaded`) and what the old page started ends: every capture of its
// plugin stops (ADR 0245) as on the runtime's own reload, and nobody else's. The frame the shell
// loaded is left as it is.
import type { PluginManifest } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { createRuntime } from "../runtime";

const centre = (id: string): PluginManifest => ({
  id,
  version: "0.1.0",
  kind: "ui",
  entry: "ui/index.html",
  surfaces: [{ id: "main", title: id.toUpperCase(), placement: "center" }],
});

const CAPTURES = [
  { captureId: "a-1", caller: "a.one" },
  { captureId: "a-2", caller: "b.two" },
  { captureId: "a-3", caller: "a.one" },
];
const scope = { permission: "audio:capture" };

/** Let `ms` pass, then let what it set off settle. */
async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

/** A desk of a.one and b.two on the stub core, while the core says those three captures run. */
async function desk() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const core = browserCore({
    manifests: ["a.one", "b.two"].map(centre),
    handlers: { "audio.capture.stop": () => ({}) },
  });
  const runtime = createRuntime({
    root,
    bridge: core.client,
    language: "en",
    plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
  });
  let started = false;
  void runtime.plugins?.ready.then(() => {
    started = true;
  });
  for (let i = 0; i < 50 && !started; i++) await flush(10);
  core.stub.emit({ event: "audio.capturing", data: { captures: CAPTURES } });
  await flush();
  let seen = 0;
  /** The captures stopped since the last look, and whom each stop was sent as. */
  const stops = () => {
    const sent = core.stub.log.slice(seen);
    seen = core.stub.log.length;
    return sent
      .filter(({ request }) => request.method === "audio.capture.stop")
      .map(({ caller, request }) => ({ caller, params: request.params }));
  };
  const frame = (id: string) => root.querySelector(`[data-surface="${id}"] iframe`);
  return { runtime, stops, frame };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a plugin page the shell loaded again by itself", () => {
  it("stops every capture of that plugin and nobody else's, with the stop a reload of its own makes", async () => {
    const { runtime, stops, frame } = await desk();
    stops();
    const before = frame("a.one");
    expect(before).not.toBeNull();

    runtime.frames.loadedAgain("a.one");
    await flush();
    const told = stops();
    expect(told).toEqual([
      { caller: undefined, params: { captureId: "a-1", scope } },
      { caller: undefined, params: { captureId: "a-3", scope } },
    ]);
    // The shell loaded the page already: the runtime neither unloads nor loads it again.
    expect(frame("a.one")).toBe(before);
    expect(runtime.frames.state("a.one")).toBe("responding");

    // The runtime's own reload of a.one (its renderer died) ends them the same way.
    expect(runtime.frames.crashed("a.one")).toBe(true);
    await flush();
    expect(stops()).toEqual(told);
  });
});
