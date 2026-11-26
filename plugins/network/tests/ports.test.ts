import { describe, expect, it } from "vitest";
import { networkOf, parseIp } from "../ui/ipv4.js";
import { allowPorts, scopeFor } from "../ui/ports.js";
import { fakeBridge } from "./harness";

const first = "192.168.0.21";
const second = "192.168.0.23";

describe("batch port consent", () => {
  it("reviews the combined fixed scopes once and refuses without a connection attempt", async () => {
    const bridge = fakeBridge({ "perm.request": () => ({ granted: false }) });
    const network = networkOf(parseIp(first) as number, 24);
    await expect(
      allowPorts(bridge, [first, second, first], network, "Known devices"),
    ).rejects.toMatchObject({
      code: "ports-denied",
    });
    expect(bridge.calls).toEqual([
      {
        method: "perm.request",
        params: {
          permission: {
            permission: "net:connect",
            hosts: [...scopeFor(first).hosts, ...scopeFor(second).hosts],
          },
          duration: "always",
          reason: "Known devices",
        },
      },
    ]);
  });

  it("rejects an address outside the attached network before asking", async () => {
    const bridge = fakeBridge();
    const network = networkOf(parseIp(first) as number, 24);
    await expect(
      allowPorts(bridge, [first, "192.168.1.21"], network, "Known devices"),
    ).rejects.toMatchObject({ code: "other-range" });
    expect(bridge.calls).toEqual([]);
  });
});
