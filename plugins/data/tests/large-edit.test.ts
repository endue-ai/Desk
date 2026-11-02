// A 10 MiB JSON opens in the SDK worker; one value edited there and saved differs from the file only
// in that value's bytes. The file is generated here, not committed.
import { afterEach, expect, it, vi } from "vitest";
import { defineUiPlugin, readBytes } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { assertMinimalEdit } from "../../../packages/plugin-sdk/src/testing/round-trip";
import { createData } from "../ui/data.js";
import { largeJson } from "./edit-fixtures.mjs";
import { file, recordingView } from "./harness";
import { workerHarness } from "./worker-harness";

afterEach(() => vi.unstubAllGlobals());

it("edits one value of a 10 MiB JSON in the worker and saves only that value's bytes", async () => {
  const payload = largeJson(10 * 1024 * 1024);
  expect(payload.length).toBeGreaterThanOrEqual(10 * 1024 * 1024);
  const target = file("~/data/large.json");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const match = /bytes=(\d+)-(\d+)/.exec(String(init.headers.Range));
      if (!match) throw new Error("Missing byte range");
      return new Response(payload.slice(Number(match[1]), Number(match[2]) + 1), { status: 206 });
    }),
  );
  let written: Uint8Array | undefined;
  const host = createTestHost({
    pluginId: "endue.data",
    handlers: {
      "fs.url": () => ({
        url: "https://fixture.invalid/large",
        type: "application/json",
        size: payload.length,
      }),
      "fs.watch": () => ({ watchId: "fixture" }),
      "fs.write": ({ content }) => {
        written = new Uint8Array(Buffer.from(String(content), "base64"));
        return { bytesWritten: written.length };
      },
      "store.get": () => ({}),
    },
    commands: { "desk.buffers.update": () => undefined },
  });
  const view = recordingView();
  const worker = workerHarness();
  let app: ReturnType<typeof createData> | undefined;
  try {
    await defineUiPlugin(
      {
        mount(ctx) {
          app = createData(ctx, view, { readBytes, startWorker: worker.start });
        },
      },
      host.transport,
    );
    await host.command("desk.files.visit", target);
    const shown = view.shown.at(-1);
    expect(shown?.opened.remote).toBeDefined();
    expect(shown?.tier).toBe("lossless");
    if (!app) throw new Error("the plugin did not mount");

    // Record 5000's name: [root, item 5000, its second member].
    await expect(app.begin([0, 5000, 1])).resolves.toBe("Record 5000");
    await app.edit([0, 5000, 1], "Edited record");
    expect(host.ran.filter((r) => r.name === "desk.buffers.update")).toHaveLength(1);
    expect(view.shown.at(-1)?.opened.remote).toBeDefined();

    await host.command("desk.files.save", target);
    if (!written) throw new Error("nothing was written");
    assertMinimalEdit(payload, written, {
      find: '"name": "Record 5000"',
      bytes: '"name": "Edited record"',
    });
    await host.command("desk.buffers.closed", target);
  } finally {
    worker.close();
  }
}, 60_000);
