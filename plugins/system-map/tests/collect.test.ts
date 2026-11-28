import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { collect, readReport, reports } from "../ui/collect.js";

it("requests only declared commands and never spawns after denial", async () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
  const request = vi.fn(async () => ({ granted: false }));
  const call = vi.fn();
  await expect(
    collect(
      { perm: { request }, messages: { t: () => "Read local reports" }, bridge: { call } },
      new AbortController().signal,
    ),
  ).rejects.toThrow("denied");
  expect(call).not.toHaveBeenCalled();
  expect(new Set(manifest.permissions[0].commands)).toEqual(
    new Set(Object.values(reports).map(([cmd]) => cmd)),
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("reads early output in order and releases its event subscription", async () => {
  type Event = { event: string; data: Record<string, unknown> };
  let emit = (_event: Event) => {};
  const off = vi.fn();
  const bridge = {
    onEvent(listener: typeof emit) {
      emit = listener;
      return off;
    },
    async call() {
      emit({ event: "proc.output", data: { procId: "other", data: "unrelated" } });
      for (const bytes of [[0xec], [0x84, 0xbc]])
        emit({
          event: "proc.output",
          data: {
            procId: "job",
            data: Buffer.from(bytes).toString("base64"),
            encoding: "base64",
            stream: "stdout",
          },
        });
      emit({ event: "proc.exit", data: { procId: "job", code: 0 } });
      return { procId: "job" };
    },
  };
  expect(await readReport(bridge, reports.hardware, new AbortController().signal)).toBe("센");
  expect(off).toHaveBeenCalledOnce();
});
