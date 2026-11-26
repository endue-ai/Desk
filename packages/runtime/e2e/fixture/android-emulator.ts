import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import manifest from "../../../../plugins/android-emulator/plugin.json";
import theme from "../../../../plugins/theme/plugin.json";
import "../../src/desk.css";
import { browserCore, memoryStore } from "../../src/bridge/core";
import { createRuntime, ManualClock } from "../../src/index";

const commands: string[] = [];
const canvas = document.createElement("canvas");
canvas.width = 100;
canvas.height = 200;
canvas.getContext("2d")?.fillRect(0, 0, 100, 200);
const frame = canvas.toDataURL("image/png").split(",")[1] ?? "";
const clock = new ManualClock();
let sequence = 0;
let emit: (event: BridgeEvent) => void = () => {};
const core = browserCore({
  manifests: [theme, manifest] as PluginManifest[],
  store: memoryStore(),
  handlers: {
    "proc.spawn": ({ command, args = [] }) => {
      const procId = `p-${++sequence}`;
      const line = args.join(" ");
      commands.push(`${command} ${line}`);
      const binary = line.endsWith("exec-out screencap -p");
      let data = "OK\r\n";
      if (binary) data = frame;
      else if (line === "-list-avds") data = "Pixel_Test\nTablet\n";
      else if (line.endsWith(" devices -l"))
        data =
          "List of devices attached\nusb-id\tdevice\nemulator-5554\tdevice transport_id:12\nemulator-5556\toffline transport_id:13\n";
      else if (line.endsWith("emu avd name")) data = "Pixel_Test\r\nOK\r\n";
      else if (line.endsWith("sys.boot_completed")) data = "1\n";
      else if (line.endsWith("pm list packages -3")) data = "package:demo.notes\n";
      else if (line.endsWith("dumpsys meminfo -s demo.notes"))
        data = "App Summary\nTOTAL PSS: 4218\n";
      else if (line.includes("logcat -d"))
        data = "I TestApp: Started\nW ActivityManager: Resumed\n";
      else if (line.endsWith("snapshot list"))
        data = "--        baseline      68M 2026-11-21 12:00:00    00:00:22.300\nOK\n";
      setTimeout(() => {
        emit({
          event: "proc.output",
          data: { procId, stream: "stdout", data, encoding: binary ? "base64" : "utf8" },
        });
        emit({ event: "proc.exit", data: { procId, code: 0 } });
      }, 0);
      return { procId };
    },
    "proc.kill": () => ({}),
  },
});
emit = (event) => core.stub.emit(event);
const runtime = createRuntime({
  root: document.getElementById("desk") as HTMLElement,
  bridge: core.client,
  clock,
  platform: "other",
  plugins: { url: (id, path, revision) => `/plugins/${id}/${path}?v=${revision}` },
});
window.__desk = { clock, runtime, stub: core.stub, commands };
