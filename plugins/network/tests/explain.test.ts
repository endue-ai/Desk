// "Explain simply" (NET-16): what goes to the brain is a device's kind, manufacturer and open ports
// and the score's items, never a name the person gave, an SSID or an address; the answer is a tool
// call's arguments; without a brain the fixed sentence stands.
import { describe, expect, it } from "vitest";
import { checkup } from "../ui/checkup.js";
import {
  checkupPayload,
  createExplainer,
  devicePayload,
  EXPLAIN_TOOL,
  promptFor,
} from "../ui/explain.js";
import { fakeBridge } from "./harness";

const camera = {
  mac: "00:bc:99:12:34:56",
  ip: "192.168.0.23",
  name: "Grandma's living room camera",
  mdns: "LivingRoomCam",
  vendor: "Hangzhou Hikvision Digital",
  randomMac: false,
  kind: "camera",
  kindGuessed: false,
  mine: true,
  known: true,
  gateway: false,
  self: false,
  online: true,
  ping: 140,
  speed: "slow",
  first: "2026-11-17T00:00:00.000Z",
  last: "2026-11-17T00:00:00.000Z",
  status: "caution",
  open: [23, 80],
  risky: [23],
} as const;

describe("what the brain is told", () => {
  it("is the kind, the manufacturer, the open ports and the score's items only", () => {
    const device = devicePayload(camera as never);
    expect(device).toEqual({
      kind: "camera",
      manufacturer: "Hangzhou Hikvision Digital",
      openPorts: [
        { port: 23, service: "Telnet" },
        { port: 80, service: "HTTP" },
      ],
      pingSpeed: "slow",
    });
    const c = checkup(
      [camera as never],
      { security: "wpa2-personal", applies: true },
      () => "Grandma's living room camera",
    );
    const payload = checkupPayload(c, [camera as never]);
    const prompt = promptFor({ device, ...payload }, "ko");
    for (const secret of ["Grandma", "LivingRoomCam", "192.168.0.23", "00:bc:99", "Home Wi-Fi"])
      expect(prompt).not.toContain(secret);
    expect(prompt).toContain("Korean");
    expect(prompt).toContain("IP 주소, MAC 주소, 제조사, 포트, Wi-Fi 채널, 핑(ms)");
    expect(payload.items.map((i) => i.item)).toEqual(["unknown", "ports", "wifi"]);
    const random = devicePayload({ ...camera, randomMac: true, vendor: null } as never);
    expect(random.manufacturer).toBe("random MAC address");
  });
});

describe("the answer", () => {
  it("is the tool call's arguments", async () => {
    const bridge = fakeBridge({
      "brain.ask": (params) => {
        expect(params.tool).toEqual(EXPLAIN_TOOL);
        expect(params.scope).toEqual({ permission: "brain:ask" });
        queueMicrotask(() =>
          bridge.emit("brain.turn", {
            turnId: "t1",
            kind: "completed",
            structured: {
              summary: "Port 23 (Telnet) sends passwords unencrypted.",
              steps: ["Turn Telnet off."],
            },
          }),
        );
        return { turnId: "t1" };
      },
    });
    const answer = await createExplainer(bridge).explain(
      { device: devicePayload(camera as never) },
      "en",
    );
    expect(answer).toEqual({
      summary: "Port 23 (Telnet) sends passwords unencrypted.",
      steps: ["Turn Telnet off."],
    });
  });

  it("asks the person once for the brain:ask grant, then asks the brain", async () => {
    let granted = false;
    const bridge = fakeBridge({
      "brain.ask": () => {
        if (!granted) throw Object.assign(new Error("denied"), { code: "permission_denied" });
        queueMicrotask(() =>
          bridge.emit("brain.turn", {
            turnId: "t4",
            kind: "completed",
            structured: { summary: "Fine.", steps: [] },
          }),
        );
        return { turnId: "t4" };
      },
      "perm.request": (params) => {
        expect(params).toEqual({ permission: { permission: "brain:ask" }, reason: "why" });
        granted = true;
        return { granted: true };
      },
    });
    expect(await createExplainer(bridge).explain({}, "en", "why")).toEqual({
      summary: "Fine.",
      steps: [],
    });
    expect(bridge.calls.filter((c) => c.method === "perm.request")).toHaveLength(1);
  });

  it("is nothing without a brain, with it off, or in words only, so the fixed sentence stands", async () => {
    const none = fakeBridge();
    expect(await createExplainer(none).explain({}, "en")).toBeNull();
    const offline = fakeBridge({
      "brain.ask": () => {
        queueMicrotask(() => offline.emit("brain.turn", { turnId: "t2", kind: "offline" }));
        return { turnId: "t2" };
      },
    });
    expect(await createExplainer(offline).explain({}, "en")).toBeNull();
    const prose = fakeBridge({
      "brain.ask": () => {
        queueMicrotask(() => prose.emit("brain.turn", { turnId: "t3", kind: "completed" }));
        return { turnId: "t3" };
      },
    });
    expect(await createExplainer(prose).explain({}, "en")).toBeNull();
  });
});
