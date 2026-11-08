import { BridgeClient, browserStub } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PolicyHub } from "./hub";

describe("PolicyHub.readInit", () => {
  it("keeps the problem init.get reports, so the desk can say init.yaml is not in force", async () => {
    const bridge = new BridgeClient(
      browserStub({
        "init.get": () => ({ profile: "default", settings: {}, problem: "line 3 is not YAML" }),
      }),
    );
    const hub = new PolicyHub(bridge);
    await hub.readInit(bridge);
    expect(hub.initProblem).toBe("line 3 is not YAML");
    expect(hub.startProfile).toBe("default");
  });

  it("has no problem when init.get reports none", async () => {
    const bridge = new BridgeClient(
      browserStub({ "init.get": () => ({ profile: "focus", settings: {} }) }),
    );
    const hub = new PolicyHub(bridge);
    await hub.readInit(bridge);
    expect(hub.initProblem).toBeUndefined();
    expect(hub.startProfile).toBe("focus");
  });
});
