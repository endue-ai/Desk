// The canvas map and surfaces' snapshots on the compositor (#54, ADR 0161). The map is the
// compositor's (the twin of the runtime's shell-canvas.spec case it replaces, shell/Minimap.ts gone):
// it shows while the canvas holds something to find, draws each normal window from its panes'
// thumbnails, takes the view where it is pressed, moves it with a drag (Escape puts it back), and
// folds to its button and opens again. The bridge oracle says where the canvas is
// (desk.windows.list's pan) and `compositor_stats` what the map draws. ui.surface.snapshot, called
// over the desk socket as the CLI, answers a PNG of a plugin's surface as the compositor holds it.
import { browser, expect } from "@wdio/globals";
import { feed, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { emptyAt, wheel } from "../support/gestures";
import { decodePng } from "../support/pixels";
import {
  byId,
  call,
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  openWindow,
  panOf,
  run,
  until,
  type Window,
} from "../support/windows";

const NOTES = "endue.notes";
const MANAGE = { permission: "plugin:manage" };

interface MapState {
  shows: boolean;
  folded?: boolean;
  outer?: number[];
  canvas?: number[];
  button?: number[];
  view?: number[];
  windows?: Array<{ id: string; rect: number[]; focused: boolean; thumbnails: number }>;
  thumbnails?: number;
}

const mapNow = async () =>
  (await shellCommand<{ wm: { map: MapState } }>("compositor_stats")).wm.map;

async function mapUntil(test: (m: MapState) => boolean, what: string): Promise<MapState> {
  let last: MapState | undefined;
  await browser.waitUntil(
    async () => {
      last = await mapNow();
      return test(last);
    },
    { timeout: 8_000, interval: 100, timeoutMsg: `${what}: ${JSON.stringify(last)}` },
  );
  return last as MapState;
}

const middle = (r: number[] = []) => {
  const [x = 0, y = 0, w = 0, h = 0] = r;
  return { x: x + w / 2, y: y + h / 2 };
};
const pointer = (p: { x: number; y: number }) => ({
  type: "pointerMoved",
  x: Math.round(p.x),
  y: Math.round(p.y),
});
const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
const clickAt = (p: { x: number; y: number }) => feed([pointer(p), button(true), button(false)]);

/** Notes' window shown and in use, asked again while the plugin still mounts. */
async function showNotes(): Promise<void> {
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin: NOTES }).catch(() => undefined);
      return byId(await deskNow(), NOTES)?.focused === true;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: "Notes is not shown and in use" },
  );
}

describe("the canvas map and snapshots on the compositor (#54)", () => {
  before(async () => {
    await shellReady();
    // Every plugin off: a plugin window in its slot is on every desktop, so the canvas starts empty.
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await closeShellWindows();
  });

  it("shows a window out of sight, and a press or a drag moves the view; it folds to its button", async () => {
    // An empty canvas at the start has nothing to find.
    expect((await mapNow()).shows).toBe(false);
    const id = await openWindow();
    const opened = await mapUntil((m) => m.shows && !m.folded, "a normal window: the map shows");
    expect(opened.windows?.map((w) => w.id)).toEqual([id]);
    // The background wheel takes the window out of sight to the left; the map still draws it.
    await wheel(emptyAt(await deskNow()), 1500, 0);
    await until((d) => panOf(d).x === -1500, "panned by the wheel");
    const far = await mapUntil(
      (m) => m.windows?.[0]?.rect[0] !== opened.windows?.[0]?.rect[0],
      "redrawn",
    );
    // A press on it brings the view to it: the window comes back with its middle at the centre.
    await clickAt(middle(far.windows?.[0]?.rect));
    const centred = await until((d) => panOf(d).x !== -1500, "the press moved the view");
    const back = byId(centred, id) as Window;
    const { w, h } = centred.screen;
    expect(Math.abs(back.x + back.w / 2 - w / 2)).toBeLessThan(30);
    expect(Math.abs(back.y + back.h / 2 - h / 2)).toBeLessThan(30);
    // Dragging the part in sight moves the view the same way, many world pixels to one.
    const before = panOf(centred);
    const frame = middle((await mapNow()).view);
    await feed([
      pointer(frame),
      button(true),
      pointer({ x: frame.x + 10, y: frame.y }),
      pointer({ x: frame.x + 20, y: frame.y }),
      button(false),
    ]);
    const dragged = await until((d) => panOf(d).x < before.x - 100, "the drag moved the view");
    // Escape in the middle of a drag puts the view back.
    const held = panOf(dragged);
    const view = middle((await mapNow()).view);
    await feed([pointer(view), button(true), pointer({ x: view.x + 15, y: view.y + 5 })]);
    await until((d) => panOf(d).x !== held.x, "dragging");
    await feed([
      { type: "key", key: "Escape", code: "Escape", pressed: true },
      { type: "key", key: "Escape", code: "Escape", pressed: false },
      button(false),
    ]);
    await until((d) => panOf(d).x === held.x && panOf(d).y === held.y, "Escape put it back");
    // It folds to one button and opens again; the session keeps which.
    const open = await mapNow();
    const [x = 0, y = 0, ow = 0] = open.outer ?? [];
    await clickAt({ x: x + ow - 18, y: y + 18 });
    const folded = await mapUntil((m) => m.folded === true, "folded");
    await clickAt(middle(folded.button));
    await mapUntil((m) => m.folded === false, "open again");
  });

  it("draws the windows from their surfaces' thumbnails", async () => {
    await call("plugin.setEnabled", { plugin: NOTES, enabled: true, scope: MANAGE });
    await showNotes();
    const map = await mapUntil(
      (m) =>
        (m.windows ?? []).some((w) => w.id === NOTES && w.thumbnails === 1) &&
        (m.thumbnails ?? 0) > 0,
      "Notes' window from its thumbnail",
    );
    expect(map.thumbnails).toBeGreaterThan(0);
  });

  it("ui.surface.snapshot answers a PNG of a plugin's surface as the compositor holds it", async () => {
    await showNotes();
    const scope = { permission: "ui:surface" };
    type Shot = {
      image: string;
      mediaType: string;
      width: number;
      height: number;
      scale: number;
      asleep: boolean;
    };
    let shot: Shot | undefined;
    await browser.waitUntil(
      async () => {
        shot = (await call("ui.surface.snapshot", { plugin: NOTES, scope }).catch(
          () => undefined,
        )) as Shot | undefined;
        return shot !== undefined;
      },
      { timeout: 10_000, interval: 300, timeoutMsg: "Notes painted a frame" },
    );
    const got = shot as Shot;
    expect(got.mediaType).toBe("image/png");
    expect(got.asleep).toBe(false);
    const png = decodePng(Buffer.from(got.image, "base64"));
    expect([png.width, png.height]).toEqual([got.width, got.height]);
    // Notes' pane, at the window's scale: most of it is drawn, not transparent.
    const window = byId(await deskNow(), NOTES) as Window;
    expect(got.width / got.scale).toBeLessThanOrEqual(window.w);
    let opaque = 0;
    for (let i = 3; i < png.data.length; i += 4) opaque += png.data[i] === 255 ? 1 : 0;
    expect(opaque / (png.width * png.height)).toBeGreaterThan(0.9);
    // Bounded, with its aspect ratio kept.
    const small = (await call("ui.surface.snapshot", {
      plugin: NOTES,
      maxWidth: 120,
      scope,
    })) as Shot;
    expect(small.width).toBe(120);
    expect(Math.abs(small.height - Math.round((got.height * 120) / got.width))).toBeLessThanOrEqual(
      1,
    );
    // A plugin with no surface on the desk has nothing to show.
    await expect(call("ui.surface.snapshot", { plugin: "e2e.nobody", scope })).rejects.toThrow(
      /shows no surface|not_found/,
    );
  });
});
