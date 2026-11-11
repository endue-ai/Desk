// @vitest-environment jsdom
// The desk puts an Images window nobody sees to sleep and loads it again when it shows (ADR 0070,
// ADR 0176): Images answers ui.surface.state through the SDK's keepFiles with its files, the one on
// screen with the view's zoom, pan and turn, and each one's watch, and comes back to them; a file the
// desk lists that the frame lost opens again on show or revert, instead of "No image" (#162, draft
// 08 #1 and #18). The real view on the plugin's index.html; jsdom measures the stage 800 x 600.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createView } from "../ui/view.js";
import { pngHeader } from "./build";
import { denied, disk, folderScope, type Handlers, image, mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const A = image("~/Pictures/a.png");
const B = image("~/Pictures/b.png");
const FILES = { [A.path]: pngHeader(1600, 1200), [B.path]: pngHeader(1600, 1200) };

type Actions = Record<string, (...args: unknown[]) => unknown>;
type Mounted = Awaited<ReturnType<typeof mount>>;

/** A fresh page of the plugin with the real view: as a window that loads (again). */
async function page(options: { handlers?: Handlers; restored?: unknown; settled?: boolean } = {}) {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  return mount({
    handlers: options.handlers ?? disk(FILES),
    settled: options.settled ?? true,
    ...(options.restored === undefined ? {} : { restored: options.restored }),
    view: (app) =>
      createView(
        document,
        (action: string, ...args: unknown[]) =>
          (app() as unknown as Actions | undefined)?.[action]?.(...args),
        { measure: () => ({ width: 800, height: 600 }), paint: () => {} },
      ),
  });
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const zoom = () => byId("zoom-level").textContent;
const transform = () =>
  (document.querySelector("#pane-a .media") as HTMLElement | null)?.style.transform;
const press = (key: string, mod = false) =>
  byId("stage").dispatchEvent(
    new KeyboardEvent("keydown", { key, metaKey: mod, bubbles: true, cancelable: true }),
  );
const asleep = async (mounted: Mounted) =>
  ((await mounted.host.surfaceState()) as { state: unknown }).state;

/** A and B open, B on screen mirrored, at 67 % and panned 40 px left and up. */
async function twoImages() {
  const first = await page();
  await first.host.command("desk.files.visit", A);
  await first.host.command("desk.files.visit", B);
  await first.settle();
  byId("flip").click();
  press("=", true);
  press("ArrowRight");
  press("ArrowDown");
  expect(zoom()).toBe("67%");
  return { first, seen: transform() };
}

describe("put to sleep while hidden, and back", () => {
  it("answers ui.surface.state with its files, the view of the one on screen and their watches", async () => {
    const { first, seen } = await twoImages();
    expect(seen).toBe("translate(-40px, -40px) rotate(0deg) scale(-0.67, 0.67)");
    expect(await asleep(first)).toEqual({
      v: 1,
      files: [
        { ...A, place: { watchId: "w1" } },
        {
          ...B,
          place: {
            view: { zoom: 0.67, x: -40, y: -40, rotation: 0, flipped: true },
            watchId: "w2",
          },
        },
      ],
      shown: B.buffer,
    });
  });

  it("comes back to the image on screen at its zoom, pan and turn, without asking or taking the focus", async () => {
    const { first, seen } = await twoImages();
    const state = await asleep(first);
    const second = await page({ restored: state });
    await vi.waitFor(() => expect(byId("name").textContent).toBe("b.png"));
    expect(zoom()).toBe("67%");
    expect(transform()).toBe(seen);
    expect(byId("flip").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).not.toBe(byId("stage"));
    expect(second.params("perm.request")).toEqual([]);
    // Its watch from before the sleep still follows it: nothing is watched anew.
    expect(second.params("fs.watch")).toEqual([]);
    second.host.emit({
      event: "fs.changed",
      data: { watchId: "w2", path: B.path, change: "modified" },
    });
    await second.settle();
    expect(second.ran("desk.files.changed")).toEqual([{ path: B.path }]);
  });

  it("opens a kept image that was not on screen when it is shown, and keeps both when it sleeps again", async () => {
    const { first } = await twoImages();
    const state = await asleep(first);
    const second = await page({ restored: state });
    await vi.waitFor(() => expect(byId("name").textContent).toBe("b.png"));
    expect(((await asleep(second)) as { files: unknown[] }).files).toHaveLength(2);
    await second.host.command("desk.buffers.show", A);
    expect(byId("name").textContent).toBe("a.png");
    expect(zoom()).toBe("50%");
    expect(document.activeElement).toBe(byId("stage"));
  });

  it("a show of the image on screen while it opens again waits for it, and shows it as it was", async () => {
    const { first, seen } = await twoImages();
    const state = await asleep(first);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plain = disk(FILES);
    const read = plain["fs.read"];
    if (!read) throw new Error("the disk reads");
    const second = await page({
      restored: state,
      handlers: {
        ...plain,
        "fs.read": async (params, caller) => {
          await gate;
          return read(params, caller);
        },
      },
      settled: false,
    });
    const show = second.host.command("desk.buffers.show", B);
    release();
    await expect(show).resolves.toBeUndefined();
    expect(byId("name").textContent).toBe("b.png");
    expect(transform()).toBe(seen);
    expect(second.params("fs.read").length).toBeGreaterThan(0);
    // Read once: the show waited for the waking read instead of reading the file again.
    expect(new Set(second.params("fs.read").map((p) => JSON.stringify(p))).size).toBe(
      second.params("fs.read").length,
    );
  });

  it("forgets a kept image the desk closes", async () => {
    const { first } = await twoImages();
    const second = await page({ restored: await asleep(first) });
    await expect(second.host.command("desk.buffers.closed", A)).resolves.toBeUndefined();
    await expect(second.host.command("desk.buffers.show", A)).rejects.toThrow(
      `No image ${A.buffer}.`,
    );
    const again = (await asleep(second)) as { files: Array<{ path: string }> };
    expect(again.files.map((f) => f.path)).toEqual([B.path]);
  });

  it("a revert of an image the desk lists that its page lost reads it again (#162)", async () => {
    // A page that loaded again without a kept state holds nothing; the desk still lists A.
    const cold = await page();
    await expect(cold.host.command("desk.files.revert", A)).resolves.toBeUndefined();
    await cold.host.command("desk.buffers.show", A);
    expect(byId("name").textContent).toBe("a.png");
  });

  it("does not ask for a folder as it wakes; the person's show of the image does", async () => {
    const { first, seen } = await twoImages();
    const state = await asleep(first);
    const plain = disk(FILES);
    const read = plain["fs.read"];
    if (!read) throw new Error("the disk reads");
    let allowed = false;
    const second = await page({
      restored: state,
      handlers: {
        ...plain,
        "fs.read": (params, caller) => {
          if (!allowed) throw denied(`fs:read over ${B.path}`);
          return read(params, caller);
        },
        "perm.request": ({ permission }) => {
          allowed = true;
          const grant = {
            grantId: "g1",
            permission,
            duration: "session" as const,
            grantedAt: "2026-11-12T00:00:00Z",
          };
          return { granted: true, grant };
        },
      },
    });
    await vi.waitFor(() =>
      expect(byId("status").textContent).toBe(`Not allowed to read ${B.path}.`),
    );
    expect(second.params("perm.request")).toEqual([]);
    await second.host.command("desk.buffers.show", B);
    expect(second.params("perm.request")).toEqual([
      expect.objectContaining({ permission: folderScope(B.path) }),
    ]);
    expect(byId("name").textContent).toBe("b.png");
    expect(transform()).toBe(seen);
  });

  it("starts empty from a state it cannot read", async () => {
    const cold = await page({ restored: { images: [] } });
    expect(byId("name").textContent).toBe("No image open");
    expect(await asleep(cold)).toEqual({ v: 1, files: [], shown: null });
  });
});
