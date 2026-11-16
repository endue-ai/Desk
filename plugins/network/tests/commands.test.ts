// @vitest-environment jsdom
// The commands (NET-19) as an agent runs them: "who is on my network right now?" answered by
// endue.network.devices, a name given, the checkup, the channels without SSIDs, the log, and a
// refusal said as the command's failure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../ui/app.js";
import { wireCommands } from "../ui/commands.js";
import { parseOui } from "../ui/oui.js";
import { createStore } from "../ui/store.js";
import { createView } from "../ui/view.js";
import * as F from "./fixtures";
import { englishT, fakeBridge, macRunner } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");

async function wired(overrides: Partial<Record<string, string>> = {}, platform = "mac") {
  const t = await englishT();
  const bridge = fakeBridge({
    "perm.request": () => ({ granted: true }),
    "net.connect": () => {
      throw Object.assign(new Error("refused"), { code: "io_error" });
    },
  });
  const handlers = new Map<string, (args: unknown) => unknown>();
  const app = createApp({
    bridge,
    runner: macRunner(overrides) as never,
    store: createStore(bridge),
    oui: () => parseOui(F.OUI),
    t,
    language: () => "en",
    platform,
    view: createView(new DOMParser().parseFromString(html, "text/html"), () => {}),
    timers: { set: (() => 0) as never, clear: () => {} },
  });
  const on = (id: string, h: (args: unknown) => unknown) => {
    handlers.set(id, h);
    return () => {};
  };
  wireCommands({ commands: { on } }, app, t);
  const run = (id: string, args: Record<string, unknown> = {}) => (handlers.get(id) as any)(args);
  return { run, app, bridge };
}

describe("the commands", () => {
  it("answer who is on the network, scanning first when nothing was scanned", async () => {
    const { run } = await wired();
    const answer = await run("endue.network.devices");
    expect(answer.network).toEqual({
      cidr: "192.168.0.0/24",
      router: "192.168.0.1",
      interface: "en0",
      administrator: null,
    });
    expect(
      answer.devices.map((d: any) => [d.label, d.ipAddress, d.manufacturerText, d.status]),
    ).toEqual([
      ["Router at 192.168.0.1", "192.168.0.1", "TP-Link", "known"],
      ["Computer at 192.168.0.10", "192.168.0.10", "Apple", "known"],
      ["Computer at 192.168.0.21", "192.168.0.21", "Raspberry Pi Foundation", "new"],
      ["Camera at 192.168.0.23", "192.168.0.23", "Hangzhou Hikvision Digital", "new"],
      ["Device at 192.168.0.31", "192.168.0.31", "Google", "new"],
      ["Phone at 192.168.0.42", "192.168.0.42", "Random MAC address (may be a phone)", "new"],
    ]);
    expect(answer.devices[5]).toMatchObject({
      randomMac: true,
      manufacturer: null,
      macAddress: "6a:1f:2e:3d:4c:5b",
    });
  });

  it("name a device, check its ports and score the network", async () => {
    const { run, app, bridge } = await wired();
    await run("endue.network.scan");
    const named = await run("endue.network.name", {
      mac: "00:BC:99:12:34:56",
      name: "Living room camera",
      kind: "camera",
    });
    expect(named).toMatchObject({ name: "Living room camera", kind: "camera", status: "known" });
    await expect(run("endue.network.checkup", { mac: "00:bc:99:12:34:56" })).rejects.toThrow(
      "Say whether you run this network before any port is checked.",
    );
    await app.net.answerAdmin(true);
    bridge.calls.length = 0;
    const result = await run("endue.network.checkup", { mac: "00:bc:99:12:34:56" });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.items.map((i: any) => i.id)).toEqual(["unknown", "ports", "wifi"]);
    expect(bridge.calls.some((c) => c.method === "perm.request")).toBe(true);
  });

  it("answer the channels without any SSID, and the log newest first", async () => {
    const { run } = await wired({ profiler: F.WIFI_NAMED });
    const channels = await run("endue.network.channels");
    expect(JSON.stringify(channels)).not.toContain("Home");
    expect(JSON.stringify(channels)).not.toContain("Neighbour");
    expect(channels.bands[0]).toMatchObject({
      band: "2.4",
      recommended: 11,
      verdict: "Channel 6 is crowded; channel 11 is recommended.",
    });
    expect(channels.joined).toMatchObject({
      channel: 6,
      security: "wpa2-personal",
      signalDbm: -58,
    });
    await run("endue.network.scan");
    const log = await run("endue.network.log");
    expect(log.entries).toEqual(
      [
        {
          at: "2026-11-17T00:00:00.000Z",
          kind: "first",
          device: null,
          ipAddress: null,
          macAddress: null,
          count: 6,
        },
      ].map((e) => ({ ...e, at: expect.any(String) })),
    );
  });

  it("fail with the refusal's sentence and what to do", async () => {
    const { run } = await wired({}, "linux");
    await expect(run("endue.network.devices")).rejects.toThrow(
      "endue.network.devices: unsupported-os: The Network plugin works on macOS for now. Open it on a Mac.",
    );
  });
});
