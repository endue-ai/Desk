import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import { installBuffers } from "./buffers";
import type { DeskContext } from "./context";
import { installFiles } from "./files";

const NOTES = "test.notes";
const PATH = "~/Documents/ai-notes/blog ideas/God models.md";
const ID = `file:${PATH}`;

/** desk.files over a notes plugin whose visits wait until the test lets them finish. */
async function desk() {
  const manifests: PluginManifest[] = [
    { id: "desk.files", kind: "policy", version: "0.1.0" },
    { id: "desk.buffers", kind: "policy", version: "0.1.0" },
    {
      id: NOTES,
      kind: "ui",
      version: "0.1.0",
      entry: "ui/index.html",
      contributes: { files: [{ pattern: "*.md", plugin: NOTES }] },
    },
  ];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  /** What the plugin was asked, in order. */
  const asked: string[] = [];
  /** The visits on their way: finish one with `true`, fail it with `false`. */
  const visits: Array<(ok: boolean) => void> = [];
  const request = vi.fn(async (_plugin: string, command: string, args?: { buffer?: string }) => {
    asked.push(`${command} ${args?.buffer ?? ""}`);
    if (command !== "desk.files.visit") return null;
    // Waiting for the person to answer the plugin's permission prompt.
    await new Promise<void>((resolve, reject) =>
      visits.push((ok) => (ok ? resolve() : reject(new Error("Not allowed to read it.")))),
    );
    return null;
  });
  const ctx = {
    hub,
    bridge: core.client,
    surfaces: { show: vi.fn() },
    request,
    mounted: () => true,
    launch: async () => {},
    whenReady: async () => {},
    unmount: vi.fn(),
  } as unknown as DeskContext;
  const buffers = installBuffers(ctx, { focus: vi.fn() });
  installFiles(ctx, buffers, vi.fn());
  hub.apply(core.plugins);
  await hub.commands.settled();
  const open = () => hub.commands.run("desk.files.open", { path: PATH });
  return { open, asked, visits, buffers };
}

describe("opening a file again while its first visit is on its way", () => {
  it("joins that visit: the plugin is never asked to show a buffer it does not hold yet", async () => {
    const d = await desk();
    const first = d.open();
    await vi.waitFor(() => expect(d.visits).toHaveLength(1));
    // The person clicks the file again: nothing happened yet, a prompt is waiting.
    const second = d.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(d.asked).toEqual([`desk.files.visit ${ID}`]);

    d.visits[0]?.(true);
    await expect(first).resolves.toBe(ID);
    await expect(second).resolves.toBe(ID);
    expect(d.asked).toEqual([`desk.files.visit ${ID}`, `desk.buffers.show ${ID}`]);

    // Once it is open, opening it again shows it.
    await expect(d.open()).resolves.toBe(ID);
    expect(d.asked.at(-1)).toBe(`desk.buffers.show ${ID}`);
    expect(d.visits).toHaveLength(1);
  });

  it("fails both when the visit fails, and the next open visits again", async () => {
    const d = await desk();
    const first = d.open();
    await vi.waitFor(() => expect(d.visits).toHaveLength(1));
    const second = d.open();
    d.visits[0]?.(false);
    await expect(first).rejects.toThrow("Not allowed to read it.");
    await expect(second).rejects.toThrow("Not allowed to read it.");
    expect(d.buffers.buffers.byPath(PATH)).toBeUndefined();

    const third = d.open();
    await vi.waitFor(() => expect(d.visits).toHaveLength(2));
    d.visits[1]?.(true);
    await expect(third).resolves.toBe(ID);
  });
});
