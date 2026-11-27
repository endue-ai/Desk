import { describe, expect, it, vi } from "vitest";
import { createAndroid, parseDevices, snapshotNames } from "../ui/android.js";
import { screenPoint } from "../ui/display.js";
import { environmentSteps } from "../ui/environment.js";

describe("local Android devices", () => {
  it("resolves launcher-only activities before timing an explicit launch", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("isDefault=false\nsample.notes/.Main\n")
      .mockResolvedValueOnce("Status: ok\nTotalTime: 301");
    const android = createAndroid({ run });
    expect(
      await android.inspectApp("emulator-5554", "sample.notes", "launch", undefined),
    ).toContain("TotalTime: 301");
    expect(run.mock.calls[1]?.[1].slice(-5)).toEqual([
      "am",
      "start",
      "-W",
      "-n",
      "'sample.notes/.Main'",
    ]);
  });
  it("lists user-installed packages and reads frame statistics for one package", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("package:demo.notes\npackage:demo.music\n")
      .mockResolvedValueOnce(
        "** Graphics info for pid 400 [demo.notes] **\nTotal frames rendered: 24\nJanky frames: 1 (4.16%)\n95th percentile: 18ms\nView hierarchy:\n",
      );
    const android = createAndroid({ run });
    expect(await android.packages("emulator-5554", undefined)).toEqual([
      "demo.music",
      "demo.notes",
    ]);
    const result = await android.inspectApp("emulator-5554", "demo.notes", "frames", undefined);
    expect(result).toContain("95th percentile: 18ms");
    expect(result).not.toContain("View hierarchy");
    await expect(
      android.inspectApp("emulator-5554", "invalid;id", "memory", undefined),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("keeps local emulator transports and their state, including during boot", () => {
    expect(
      parseDevices(
        "List of devices attached\nemulator-5554\tdevice\nUSB123\tdevice\n127.0.0.1:5555\tdevice\nemulator-5556\toffline\n",
      ),
    ).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "emulator-5556", state: "offline" },
    ]);
  });

  it("pins each device operation to the loopback server and selected serial", async () => {
    const run = vi.fn().mockResolvedValue("OK\n");
    const android = createAndroid({ run });
    await android.key("emulator-5556", "Back");
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual([
      "adb",
      ["-H", "localhost", "-P", "5037", "-s", "emulator-5556", "shell", "input", "keyevent", "4"],
    ]);
    await expect(async () => android.key("usb-1", "Back")).rejects.toThrow();
    await expect(async () => android.key("emulator-5556", "4; id")).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("pins guest input and refuses port-based commands after the transport changes", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce("OK\n")
      .mockResolvedValueOnce("emulator-5556\tdevice transport_id:17\n");
    const android = createAndroid({ run });
    const signal = android.bindTransport(new AbortController().signal, "12");
    await android.key("emulator-5556", "Back", signal);
    expect(run.mock.calls[0]?.[1]).toEqual([
      "-H",
      "localhost",
      "-P",
      "5037",
      "-t",
      "12",
      "shell",
      "input",
      "keyevent",
      "4",
    ]);
    await expect(android.powerOff("emulator-5556", signal)).rejects.toThrow(
      "emulator transport disappeared",
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.lastCall?.[1].slice(-2)).toEqual(["devices", "-l"]);
  });

  it("reads snapshot tags, including the emulator's nonnumeric disk ID", () => {
    expect(
      snapshotNames(
        "List of snapshots present on all disks:\r\nID        TAG                 VM SIZE                DATE       VM CLOCK\r\n--        clean-install           68M 2026-11-21 23:04:30   00:02:10.039\r\n1         default_boot             1G 2026-11-21 08:35:15   00:00:25.001\r\nOK\r\n",
      ),
    ).toEqual(["clean-install", "default_boot"]);
    expect(snapshotNames("There is no snapshot available.\r\nOK\r\n")).toEqual([]);
  });

  it("reports console KO even when the adb process exits successfully", async () => {
    const android = createAndroid({ run: vi.fn().mockResolvedValue("KO: unknown snapshot\r\n") });
    await expect(android.snapshot("emulator-5554", "load", "missing")).rejects.toThrow(
      "unknown snapshot",
    );
  });

  it("validates the whole profile before applying it, including zero coordinates", () => {
    const profile = {
      battery: "0",
      charging: "off",
      network: "edge",
      latitude: "0",
      longitude: "-73.5",
      appearance: "yes",
      font: "1.3",
    };
    const args = environmentSteps(profile).map((step) => step.args);
    expect(args).toContainEqual(["emu", "power", "capacity", "0"]);
    expect(args).toContainEqual(["emu", "geo", "fix", "-73.5", "0"]);
    expect(args).toContainEqual(["emu", "network", "delay", "edge"]);
    expect(args).toContainEqual(["shell", "settings", "put", "system", "font_scale", "1.3"]);
    expect(() => environmentSteps({ ...profile, longitude: "" })).toThrow();
    expect(() => environmentSteps({ ...profile, latitude: "91" })).toThrow();
    expect(() => environmentSteps({ ...profile, battery: "1; id" })).toThrow();
  });

  it("maps the displayed pixels in either orientation and rejects a letterbox press", () => {
    const box = { left: 10, top: 20, width: 400, height: 400 };
    expect(screenPoint(box, 200, 400, 210, 220)).toEqual({ x: 100, y: 200 });
    expect(screenPoint(box, 200, 400, 30, 220)).toBeNull();
    expect(screenPoint(box, 400, 200, 409.9, 319.9)).toEqual({ x: 399, y: 199 });
  });
});
