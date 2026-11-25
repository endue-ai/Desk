// @vitest-environment jsdom
import { expect, it } from "vitest";
import { browserCore } from "./bridge/core";
import { ManualClock } from "./clock";
import { createRuntime } from "./runtime";

it.each([
  [true, "endue ready · bridge: browser"],
  [false, "endue cannot reach the core · bridge: browser"],
] as const)("reports the startup status when connected is %s", async (connected, expected) => {
  const root = document.createElement("div");
  document.body.append(root);
  const core = browserCore({
    manifests: [],
    handlers: connected
      ? {}
      : {
          "perm.query": () => {
            throw new Error("Core unavailable");
          },
        },
  });
  const runtime = createRuntime({ root, bridge: core.client, clock: new ManualClock() });
  try {
    await runtime.ready;
    expect(runtime.status()).toBe(expected);
    expect(root.querySelector('[role="status"]')?.textContent).toBe(expected);
  } finally {
    runtime.dispose();
    root.remove();
  }
});
