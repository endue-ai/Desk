import { expect, it, vi } from "vitest";
import type { BridgeEvent } from "../../../packages/bridge/src/index";
import { createProcesses } from "../ui/process.js";

function harness(call: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  let listener: ((event: BridgeEvent) => void) | undefined;
  const procs = createProcesses({
    call,
    onEvent(fn: typeof listener) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  });
  return {
    procs,
    output(id: string, data: string, encoding: "base64" | "utf8") {
      listener?.({ event: "proc.output", data: { procId: id, stream: "stdout", data, encoding } });
    },
    exit(id: string) {
      listener?.({ event: "proc.exit", data: { procId: id, code: 0 } });
    },
  };
}

it("preserves early binary and UTF-8 chunks, keeping simultaneous clients separate", async () => {
  const h = harness(async (_method, { command }) => {
    const id = String(command);
    h.output(id, id === "adb" ? "iVA=" : "Pixel_9", id === "adb" ? "base64" : "utf8");
    h.output(id, id === "adb" ? "NG" : "\n", "utf8");
    h.exit(id);
    return { procId: id };
  });
  const [blob, names] = await Promise.all([
    h.procs.run("adb", [], { binary: true }),
    h.procs.run("emulator", [], {}),
  ]);
  expect([...new Uint8Array(await (blob as Blob).arrayBuffer())]).toEqual([137, 80, 78, 71]);
  expect(names).toBe("Pixel_9\n");
  h.procs.dispose();
});

it("cancelling before the spawn reply kills that process under its own grant", async () => {
  let spawned!: (reply: { procId: string }) => void;
  const reply = new Promise<{ procId: string }>((resolve) => {
    spawned = resolve;
  });
  const call = vi.fn((method: string) => (method === "proc.spawn" ? reply : Promise.resolve({})));
  const h = harness(call);
  const stop = new AbortController();
  const done = h.procs.run("adb", [], { signal: stop.signal });
  stop.abort();
  spawned({ procId: "late" });
  await expect(done).rejects.toMatchObject({ name: "AbortError" });
  expect(call).toHaveBeenCalledWith("proc.kill", {
    procId: "late",
    signal: "term",
    scope: { permission: "proc:spawn", commands: ["adb"] },
  });
  h.procs.dispose();
});

it("finds an SDK outside the app's PATH and reuses its location", async () => {
  const seen: unknown[] = [];
  const h = harness(async (_method, { command, cwd }) => {
    seen.push(command);
    expect(cwd).toBe("~");
    if (command === "emulator") throw Object.assign(new Error("missing"), { code: "not_found" });
    h.exit("sdk");
    return { procId: "sdk" };
  });
  await h.procs.run("emulator", ["-list-avds"], {});
  await h.procs.run("emulator", ["-list-avds"], {});
  expect(seen).toEqual([
    "emulator",
    "Library/Android/sdk/emulator/emulator",
    "Library/Android/sdk/emulator/emulator",
  ]);
  h.procs.dispose();
});
