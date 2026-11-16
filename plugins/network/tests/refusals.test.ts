// Each refusal (NF-02) is a refusal with its sentence: outside the private network, not the
// administrator, a grant refused, a program missing, another OS, Wi-Fi off. Driven through the
// controller and the runner over fake programs and a fake bridge.
import { describe, expect, it } from "vitest";
import { createNetwork } from "../ui/network.js";
import { parseOui } from "../ui/oui.js";
import { refusalText } from "../ui/refusal.js";
import { createRunner, PROGRAMS, SPAWN_SCOPE } from "../ui/run.js";
import { createStore } from "../ui/store.js";
import * as F from "./fixtures";
import { englishT, fakeBridge, macRunner } from "./harness";

async function controller(
  options: { runner?: any; platform?: string; bridge?: ReturnType<typeof fakeBridge> } = {},
) {
  const t = await englishT();
  const bridge = options.bridge ?? fakeBridge();
  const net = createNetwork({
    bridge,
    runner: options.runner ?? macRunner(),
    store: createStore(bridge),
    oui: () => parseOui(F.OUI),
    t,
    platform: options.platform ?? "mac",
    now: () => "2026-11-17T00:00:00.000Z",
    onChange: () => {},
  });
  return { net, t, bridge };
}

const said = (t: (id: string, p?: Record<string, unknown>) => string, refusal: any) =>
  refusalText(t, refusal).text;

describe("refusals", () => {
  it("refuses a public IP address", async () => {
    const runner = macRunner({ ifconfig: F.IFCONFIG_PUBLIC });
    const { net, t } = await controller({ runner });
    await net.scan();
    expect(net.state.refusal?.code).toBe("public");
    expect(said(t, net.state.refusal)).toBe(
      "This computer has a public IP address (203.0.113.10). The plugin looks only at private networks.",
    );
    expect(runner.calls.map((c) => c.program)).toEqual(["route", "ifconfig"]);
  });

  it("says there is no network without a default route", async () => {
    const { net, t } = await controller({ runner: macRunner({ route: F.ROUTE_NONE }) });
    await net.scan();
    expect(said(t, net.state.refusal)).toBe("This computer is not on a network with a router.");
  });

  it("asks the administrator question once per network and sweeps nothing on a no", async () => {
    const runner = macRunner();
    const { net, t, bridge } = await controller({ runner });
    await net.scan();
    expect(net.state.admin).toBeUndefined();
    expect(runner.calls.filter((c) => c.program === "ping")).toHaveLength(1);
    await net.answerAdmin(false);
    expect((bridge.store.get("networks") as any)["gw-000aeb010203"].admin).toBe(false);
    await net.scan();
    expect(runner.calls.filter((c) => c.program === "ping")).toHaveLength(2);
    await expect(net.checkDevice("00:bc:99:12:34:56")).rejects.toMatchObject({ code: "not-admin" });
    expect(said(t, { code: "not-admin", params: {} })).toContain("you don't run this network");
    await net.answerAdmin(true);
    expect(runner.calls.filter((c) => c.program === "ping").length).toBeGreaterThan(250);
  });

  it("refuses a port check the person does not allow, and a device of another range", async () => {
    const bridge = fakeBridge({ "perm.request": () => ({ granted: false }) });
    const { net, t } = await controller({ bridge });
    await net.scan();
    await net.answerAdmin(true);
    const err = await net.checkDevice("00:bc:99:12:34:56").catch((e) => e);
    expect(err.code).toBe("ports-denied");
    expect(said(t, err)).toBe("Not allowed to connect to the ports of 192.168.0.23.");
    const unknown = await net.checkDevice("1c:1b:0d:df:18:0d").catch((e) => e);
    expect(unknown.code).toBe("unknown-device");
    expect(bridge.calls.some((c) => c.method === "net.connect")).toBe(false);
  });

  it("asks once for ui:notify, then tells the person about a new device", async () => {
    let granted = false;
    const bridge = fakeBridge({
      "ui.notify": () => {
        if (!granted) throw Object.assign(new Error("denied"), { code: "permission_denied" });
        return { id: "n" };
      },
      "perm.request": ({ permission }) => {
        granted = permission.permission === "ui:notify";
        return { granted };
      },
    });
    const withLaptop = `${F.ARP}? (192.168.0.77) at a4:83:e7:01:02:03 on en0 ifscope [ethernet]\n`;
    let arp = F.ARP;
    const runner = macRunner();
    const { net } = await controller({
      bridge,
      runner: {
        calls: [],
        run: (p: string, a: string[]) =>
          p === "arp" ? Promise.resolve({ code: 0, stdout: arp }) : runner.run(p, a),
      },
    });
    await net.scan();
    arp = withLaptop;
    await net.scan();
    const notes = bridge.calls.filter((c) => c.method === "ui.notify");
    expect(notes).toHaveLength(2);
    expect(notes[1]!.params).toMatchObject({
      title: "A new device joined the network",
      level: "info",
    });
    expect(bridge.calls.filter((c) => c.method === "perm.request")).toHaveLength(1);
  });

  it("keeps the busy line while any look, port check or Wi-Fi read still runs", async () => {
    const { net } = await controller();
    const seen: Array<string | null> = [];
    const both = Promise.all([net.scan(), net.readChannels()]);
    seen.push(net.state.busy?.phase ?? null);
    await both;
    expect(seen[0]).not.toBeNull();
    expect(net.state.busy).toBeNull();
    expect(net.state.wifi?.current?.channel).toBe(6);
    expect(net.state.scanned).not.toBeNull();
  });

  it("works only on macOS", async () => {
    const runner = macRunner();
    const { net, t } = await controller({ runner, platform: "windows" });
    await net.scan();
    expect(net.state.refusal?.code).toBe("unsupported-os");
    expect(said(t, net.state.refusal)).toBe("The Network plugin works on macOS for now.");
    expect(runner.calls).toEqual([]);
  });

  it("says Wi-Fi is off", async () => {
    const { net, t } = await controller({ runner: macRunner({ profiler: F.WIFI_OFF }) });
    await net.readChannels();
    expect(said(t, net.state.wifiRefusal)).toBe("Wi-Fi is off.");
  });
});

describe("the runner", () => {
  const spawned = (bridge: ReturnType<typeof fakeBridge>) =>
    bridge.calls.filter((c) => c.method === "proc.spawn");

  it("runs a program by its full path, arguments as an array, and reads its output", async () => {
    const bridge = fakeBridge({
      "proc.spawn": () => {
        queueMicrotask(() => {
          bridge.emit("proc.output", {
            procId: "p1",
            stream: "stdout",
            data: F.ROUTE,
            encoding: "utf8",
          });
          bridge.emit("proc.exit", { procId: "p1", code: 0 });
        });
        return { procId: "p1" };
      },
    });
    const runner = createRunner(bridge);
    const out = await runner.run("route", ["-n", "get", "default"]);
    expect(out).toEqual({ code: 0, stdout: F.ROUTE });
    expect(spawned(bridge)[0]!.params).toEqual({
      command: "/sbin/route",
      args: ["-n", "get", "default"],
      scope: { permission: "proc:spawn", commands: ["/sbin/route"] },
    });
    expect(Object.values(PROGRAMS).every((p) => p.startsWith("/"))).toBe(true);
  });

  it("names a missing program and asks once for a grant it lacks", async () => {
    const missing = fakeBridge({
      "proc.spawn": () => {
        throw Object.assign(new Error("no such file"), { code: "not_found" });
      },
    });
    const t = await englishT();
    const err = await createRunner(missing)
      .run("dig", [])
      .catch((e) => e);
    expect(err.code).toBe("missing-program");
    expect(said(t, err)).toBe("/usr/bin/dig is not on this computer.");

    const denied = fakeBridge({
      "proc.spawn": () => {
        throw Object.assign(new Error("denied"), { code: "permission_denied" });
      },
      "perm.request": () => ({ granted: false }),
    });
    const refused = await createRunner(denied)
      .run("arp", ["-an"])
      .catch((e) => e);
    expect(refused.code).toBe("programs-denied");
    const asks = denied.calls.filter((c) => c.method === "perm.request");
    expect(asks).toHaveLength(1);
    expect(asks[0]!.params.permission).toEqual({
      ...SPAWN_SCOPE,
      commands: [...SPAWN_SCOPE.commands],
    });
    expect(said(t, refused)).toContain("Not allowed to run macOS's network programs");
  });
});
