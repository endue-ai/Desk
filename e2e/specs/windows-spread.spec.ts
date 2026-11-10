// The spread on the compositor (#54, ADR 0116, ADR 0161): the cases the runtime's arrange.spec ran
// on the page's spread until #83 removed it, back on the CEF desk over the bridge oracle. Three of
// the shell's own windows (Calendar, Tomorrow, Notes) on a fresh desktop; desk.windows.list says
// which window has the focus and where each is (nothing on the desk moves while the spread is
// open), `compositor_stats` the spread's own state and poses, the accessibility tree its dialog, and
// the composed frame what it draws. Mod+Alt+S reaches the runtime's keymap as the person's chord;
// the spread's keys and the pointer go through the compositor's input, which the spread hears
// first. Its motions run on the window manager's clock, which a case holds (`compositor_clock`) to
// look at a fixed time (ADR 0013).
import { browser, expect } from "@wdio/globals";
import { feed, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { chord, KEY, MOD } from "../support/gestures";
import { composedFrame, decodePng, difference } from "../support/pixels";
import {
  clearDesk,
  closeShellWindows,
  deskNow,
  freshDesktop,
  inUse,
  onScreen,
  openWindow,
  type Rect,
  rectOf,
  run,
  until,
  type Window,
  windowUntil,
} from "../support/windows";

interface Pose {
  tx: number;
  ty: number;
  z: number;
  rotateY: number;
  rotateX: number;
  scale: number;
  opacity: number;
}

interface Spread {
  open: boolean;
  selected?: string | null;
  filter?: string;
  shown?: string[];
  windows?: number;
  flat?: boolean;
  closing?: unknown;
  poses?: Record<string, Pose>;
}

const spreadNow = async () =>
  (await shellCommand<{ wm: { spread: Spread } }>("compositor_stats")).wm.spread;

async function spreadUntil(test: (s: Spread) => boolean, what: string): Promise<Spread> {
  let last: Spread | undefined;
  await browser.waitUntil(
    async () => {
      last = await spreadNow();
      return test(last);
    },
    { timeout: 8_000, interval: 100, timeoutMsg: `${what}: ${JSON.stringify(last)}` },
  );
  return last as Spread;
}

/** A key through the compositor's input, down and up. */
const key = (k: string, code: string) => [
  { type: "key", key: k, code, pressed: true },
  { type: "key", key: k, code, pressed: false },
];
const press = (k: string, code = k) => feed(key(k, code));
/** Text as the input method commits it: any script, in one go. */
const typed = (text: string) => feed([{ type: "ime", ime: "commit", text }]);
const clickAt = (x: number, y: number) =>
  feed([
    { type: "pointerMoved", x: Math.round(x), y: Math.round(y) },
    { type: "pointerButton", button: "left", pressed: true },
    { type: "pointerButton", button: "left", pressed: false },
  ]);

type Seeded = { calendar: Window; tomorrow: Window; notes: Window; before: Record<string, Rect> };

/** Calendar, Tomorrow and Notes, each a window of its own, Notes in use. */
async function seed(): Promise<Seeded> {
  const shown: Record<string, Window> = {};
  for (const view of ["calendar", "tomorrow", "notes"]) {
    const id = await openWindow();
    await run(`desk.shell.open-${view}`);
    shown[view] = await windowUntil(id, (w) => w.panes[0]?.view === view, `shows ${view}`);
  }
  const desk = await until((d) => inUse(d)?.id === shown.notes?.id, "Notes in use");
  const before = Object.fromEntries(onScreen(desk).map((w) => [w.id, rectOf(w)]));
  return { ...(shown as Omit<Seeded, "before">), before };
}

const title = (w: Window) => w.panes[0]?.title ?? "";

/** The spread's dialog in the accessibility tree: its field and its options. */
interface Node {
  role: string;
  label?: string;
  value?: string;
  selected?: boolean;
  bounds?: number[];
  children: Node[];
}
const a11y = () => shellCommand<{ tree: Node | null }>("compositor_a11y", { activate: true });
function all(node: Node | null | undefined, role: string): Node[] {
  if (!node) return [];
  const here = node.role === role ? [node] : [];
  return [...here, ...node.children.flatMap((c) => all(c, role))];
}

describe("the spread on the compositor (#54)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await shellCommand("compositor_clock", { at: null });
    const open = await spreadNow();
    if (open.open) await press("Escape");
    await spreadUntil((s) => !s.open, "closed after the case");
    await closeShellWindows();
  });

  it("fans the windows out; arrows move, typing filters, Enter focuses the window", async () => {
    const { calendar, notes, before } = await seed();
    const closed = decodePng(await composedFrame());
    await chord(MOD, KEY.alt, "s");
    const fanned = await spreadUntil((s) => s.open, "Mod+Alt+S opens it");
    expect(fanned.selected).toBe(notes.id);
    expect(fanned.windows).toBe(3);
    expect(fanned.shown).toHaveLength(3);
    // Fanned out in depth: the cards turn and sit back, smaller than the windows.
    const settled = await spreadUntil(
      (s) => Object.values(s.poses ?? {}).every((p) => p.scale < 1),
      "fanned out",
    );
    expect(Object.values(settled.poses ?? {}).some((p) => p.rotateY !== 0)).toBe(true);
    // What the compositor draws changed: the desk is under a scrim, the windows fanned out.
    const spread = decodePng(await composedFrame());
    const whole = { x: 0, y: 0, w: closed.width, h: closed.height };
    expect(difference(spread, whole, closed, whole)).toBeGreaterThan(0.3);
    // A screen reader sees a dialog whose combobox is over the windows' titles, Notes selected.
    const tree = (await a11y()).tree;
    expect(all(tree, "dialog")).toHaveLength(1);
    const options = all(tree, "list-box-option");
    expect(options).toHaveLength(3);
    expect(options.filter((o) => o.selected).map((o) => o.label)).toEqual([title(notes)]);
    await press("ArrowRight");
    await spreadUntil((s) => s.selected !== notes.id, "the selection moves");
    // Typing filters by title; the selection goes to what is left.
    await typed(title(calendar).slice(0, 2));
    const filtered = await spreadUntil((s) => s.shown?.length === 1, "filtered to one");
    expect(filtered.shown).toEqual([calendar.id]);
    expect(filtered.selected).toBe(calendar.id);
    await press("Enter");
    await spreadUntil((s) => !s.open, "Enter closes it");
    const after = await until((d) => inUse(d)?.id === calendar.id, "Calendar in use");
    // Nothing on the desk moved.
    expect(Object.fromEntries(onScreen(after).map((w) => [w.id, rectOf(w)]))).toEqual(before);
  });

  it("Escape cancels it, and so does a click on the empty desk", async () => {
    const { notes } = await seed();
    await run("desk.windows.spread");
    await spreadUntil((s) => s.open, "open");
    await press("ArrowDown");
    await press("Escape");
    await spreadUntil((s) => !s.open, "Escape closes it");
    expect(inUse(await deskNow())?.id).toBe(notes.id);
    await run("desk.windows.spread");
    await spreadUntil((s) => s.open, "open again");
    const { h } = (await deskNow()).screen;
    await clickAt(30, h - 20);
    await spreadUntil((s) => !s.open, "a click on the empty desk closes it");
    expect(inUse(await deskNow())?.id).toBe(notes.id);
    // Its command closes it too.
    await run("desk.windows.spread");
    await spreadUntil((s) => s.open, "open a third time");
    await run("desk.windows.spread");
    await spreadUntil((s) => !s.open, "run again, it closes");
  });

  it("a click picks a window", async () => {
    const { tomorrow } = await seed();
    await run("desk.windows.spread");
    await spreadUntil((s) => Object.values(s.poses ?? {}).every((p) => p.scale < 1), "fanned");
    // The card's box on screen, as the accessibility tree has it (the window's logical pixels),
    // once the tree has the spread and the cards have come to rest.
    let bounds: number[] = [];
    await browser.waitUntil(
      async () => {
        const option = all((await a11y()).tree, "list-box-option").find(
          (o) => o.label === title(tomorrow),
        );
        const now = option?.bounds ?? [];
        const still = now.length === 4 && JSON.stringify(now) === JSON.stringify(bounds);
        bounds = now;
        return still && (now[2] ?? 0) > 0;
      },
      { timeout: 8_000, interval: 150, timeoutMsg: "Tomorrow's card in the tree" },
    );
    const [x = 0, y = 0, w = 0, hh = 0] = bounds;
    await clickAt(x + w / 2, y + hh / 2);
    await spreadUntil((s) => !s.open, "a click on a card closes it");
    await until((d) => inUse(d)?.id === tomorrow.id, "Tomorrow in use");
  });

  it("holds still at a fixed time on the window manager's clock, and draws the same frame there", async () => {
    await seed();
    const { now } = await shellCommand<{ now: number }>("compositor_clock", { hold: true });
    await run("desk.windows.spread");
    await spreadUntil((s) => s.open, "open");
    await shellCommand("compositor_clock", { at: now + 200 });
    const mid = await spreadNow();
    const again = await spreadNow();
    expect(again.poses).toEqual(mid.poses);
    const halfway = Object.values(mid.poses ?? {});
    expect(halfway.some((p) => p.scale < 1 && p.scale > 0.6)).toBe(true);
    const at200 = decodePng(await composedFrame());
    await shellCommand("compositor_clock", { at: now + 1000 });
    const done = await spreadNow();
    expect(done.poses).not.toEqual(mid.poses);
    await shellCommand("compositor_clock", { at: now + 200 });
    const back = decodePng(await composedFrame());
    // The cards are where they were at 200 ms (Eris's figure, which turns on its own, aside).
    const card = { x: 0, y: back.height / 2, w: back.width, h: back.height / 2 };
    expect(difference(back, card, at200, card)).toBeLessThan(0.01);
  });

  it("is a flat grid, with no motion, when motion is reduced", async () => {
    await seed();
    await run("desk.theme.motion");
    try {
      await run("desk.windows.spread");
      const flat = await spreadUntil((s) => s.open, "open");
      expect(flat.flat).toBe(true);
      // Scaled and moved in the plane only, at once: no turn and no depth.
      for (const p of Object.values(flat.poses ?? {})) {
        expect([p.rotateY, p.rotateX, p.z]).toEqual([0, 0, 0]);
        expect(p.scale).toBeLessThan(1);
      }
      await press("Escape");
      await spreadUntil((s) => !s.open, "closed at once");
    } finally {
      await run("desk.theme.motion");
    }
  });
});
