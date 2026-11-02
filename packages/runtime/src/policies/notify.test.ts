import { BridgeClient, browserStub } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installNotify } from "./notify";

/** The status line as a plain object: text, a data-level and a class list; a notice with no actions reads nothing else. */
function statusLine() {
  return {
    textContent: "",
    dataset: {} as DOMStringMap,
    classList: { toggle: () => false },
  } as unknown as HTMLElement;
}

function context(): DeskContext {
  const bridge = new BridgeClient(browserStub({}));
  return { hub: new PolicyHub(bridge), bridge, clock: new ManualClock() } as unknown as DeskContext;
}

describe("desk.notify's status line", () => {
  it("keeps the base line as the status while a notice shows", () => {
    const line = statusLine();
    const policy = installNotify(context(), line);
    policy.setBase("desk ready · bridge: browser");
    expect(policy.text()).toBe("desk ready · bridge: browser");
    policy.notify({
      caller: "desk",
      title: "No profile nope — init.yaml names it.",
      level: "warning",
    });
    expect(line.textContent).toBe("No profile nope — init.yaml names it.");
    expect(policy.text()).toBe("desk ready · bridge: browser");
  });
});
