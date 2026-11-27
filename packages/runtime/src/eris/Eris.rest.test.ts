// @vitest-environment jsdom
// At rest Eris is in the talk line (ADR 0254): the large orb comes out above the pill while she
// listens, thinks or speaks, and goes back RETURN_MS after; a place of her own keeps her in sight.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../clock";
import type { ShellCtx } from "../shell/context";
import { emptyState, Store } from "../shell/state";
import type { ErisState } from "./states";

vi.mock("./draw", async (original) => ({
  ...(await original<typeof import("./draw")>()),
  paint: () => {},
  paintMoon: () => {},
}));
const { mountEris } = await import("./Eris");
const { BODY } = await import("./draw");
const { RETURN_MS } = await import("./rest");
const { Ticker } = await import("../shell/ticker");

/** The talk pill, as the bottom edge lays it out: 440 by 40, its top 700 down the app. */
const PILL = { left: 292, top: 700, width: 440, height: 40 };
const ABOVE = {
  x: PILL.left + PILL.width / 2 - BODY.width / 2,
  y: PILL.top - 12 - BODY.height,
};

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type Place = { x: number; y: number } | null;

/** Eris on a live ticker beside a talk pill (unless `pill` is false); the layout's `eris` is `place`. */
function mount(options: { place?: Place; pill?: boolean; reduced?: boolean } = {}) {
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
  const edits: unknown[] = [];
  let place: Place = options.place ?? null;
  const ctx = {
    store: new Store(emptyState("en")),
    ticker,
    reduced: () => options.reduced === true,
    tr: (key: string) => key,
    wm: {
      edit: (batch: { op: string; at: Place }[]) => {
        edits.push(...batch);
        for (const e of batch) if (e.op === "move-eris") place = e.at;
        return Promise.resolve([]);
      },
    },
    bridge: {
      audio: { levels: () => ({ user: [], eris: [] }) },
      perm: { request: async () => true },
      brain: { say: () => new Promise(() => {}) },
    },
    runtime: {
      settings: { onChange: () => () => {} },
      themes: { onChange: () => () => {} },
    },
  } as unknown as ShellCtx;
  if (options.pill !== false) {
    const pill = document.createElement("div");
    pill.className = "composer talk-pill";
    pill.getBoundingClientRect = () =>
      ({
        ...PILL,
        x: PILL.left,
        y: PILL.top,
        right: PILL.left + PILL.width,
        bottom: PILL.top + PILL.height,
      }) as DOMRect;
    document.body.append(pill);
  }
  const eris = mountEris(document.body, ctx, () => place);
  const el = document.querySelector<HTMLElement>(".eris");
  if (!el) throw new Error("no Eris");
  const frame = (ms = 16) => clock.advance(ms);
  const setPlace = (next: Place) => {
    place = next;
    // The layout is the store's: any change to it is a store change.
    ctx.store.set({});
  };
  return { ctx, clock, eris, el, edits, frame, setPlace, dispose: () => ticker.dispose() };
}

type Mounted = ReturnType<typeof mount>;

const resting = (el: HTMLElement) => el.classList.contains("is-resting");
const at = (el: HTMLElement) => ({ x: el.style.left, y: el.style.top });
const px = (p: { x: number; y: number }) => ({ x: `${p.x}px`, y: `${p.y}px` });

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function track<T extends { eris: { dispose(): void }; dispose(): void }>(m: T): T {
  cleanups.push(() => {
    m.eris.dispose();
    m.dispose();
  });
  return m;
}

/** Out: no is-resting, in the tab order, centred over the pill with 12 between. */
function expectOut(el: HTMLElement) {
  expect(resting(el)).toBe(false);
  expect(el.getAttribute("tabindex")).toBe("0");
  expect(el.hasAttribute("aria-hidden")).toBe(false);
  expect(at(el)).toEqual(px(ABOVE));
}

describe("Eris at rest", () => {
  it("at rest with no placement the large orb is in the pill", () => {
    const { el, edits, frame } = track(mount());
    frame();
    expect(resting(el)).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("tabindex")).toBe("-1");
    frame(2000);
    expect(resting(el)).toBe(true);
    expect(edits).toEqual([]);
  });

  it("she comes out above the pill while she listens, thinks or speaks", async () => {
    const cases: [string, (m: Mounted) => unknown][] = [
      [
        "listening",
        async (m) => {
          m.eris.talk();
          await settle();
        },
      ],
      [
        "thinking",
        async (m) => {
          m.eris.talk();
          await settle();
          m.eris.talk();
        },
      ],
      ["a line said", (m) => m.eris.say("Quiet morning.")],
      ...(["done", "heads-up", "oops"] as ErisState[]).map(
        (state): [string, (m: Mounted) => unknown] => [state, (m) => m.eris.setState(state)],
      ),
    ];
    for (const [name, start] of cases) {
      const m = mount();
      m.frame();
      expect(resting(m.el), name).toBe(true);
      await start(m);
      m.frame();
      if (name === "listening") expect(m.el.dataset.talk, name).toBe("listening");
      if (name === "thinking") expect(m.el.dataset.talk, name).toBe("thinking");
      if (name === "a line said")
        expect(document.querySelector(".eris-said")?.hasAttribute("hidden"), name).toBe(false);
      expectOut(m.el);
      m.eris.dispose();
      m.dispose();
      document.body.replaceChildren();
    }
  });

  it("she goes back into the pill RETURN_MS after she is done, and not before", () => {
    const { el, eris, frame, clock } = track(mount());
    eris.setState("done");
    frame();
    expectOut(el);
    eris.setState("idle");
    frame();
    clock.advance(RETURN_MS - 1);
    expectOut(el);
    clock.advance(1);
    expect(resting(el)).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");

    // Out again; a new line within the wait keeps her out and starts the wait again.
    eris.setState("heads-up");
    frame();
    eris.setState("idle");
    frame();
    clock.advance(RETURN_MS / 2);
    eris.say("One more thing.");
    clock.advance(RETURN_MS / 2 + 16);
    expectOut(el);
    const card = document.querySelector<HTMLElement>(".eris-said");
    for (let i = 0; i < 1000 && card && !card.hidden; i++) frame();
    expect(card?.hidden, "her words are gone").toBe(true);
    clock.advance(RETURN_MS - 1);
    expectOut(el);
    clock.advance(1);
    expect(resting(el)).toBe(true);
  });

  it("a profile that places her keeps her there, in sight, at rest too", () => {
    const { el, eris, frame, setPlace } = track(mount({ place: { x: 40, y: 300 } }));
    frame();
    expect(at(el)).toEqual(px({ x: 40, y: 300 }));
    expect(resting(el)).toBe(false);
    expect(el.getAttribute("tabindex")).toBe("0");
    eris.setState("thinking");
    frame();
    expect(at(el)).toEqual(px({ x: 40, y: 300 }));
    expect(resting(el)).toBe(false);
    eris.setState("idle");
    frame();
    frame(RETURN_MS + 16);
    expect(at(el)).toEqual(px({ x: 40, y: 300 }));
    expect(resting(el)).toBe(false);
    setPlace(null);
    frame();
    expect(resting(el)).toBe(true);
  });

  it("a visible idle figure keeps rotating past the docking timeout", () => {
    const { el, frame } = track(mount({ place: { x: 40, y: 80 } }));
    frame(11000);
    const mesh = el.querySelector<HTMLElement>(".eris-mesh");
    const before = mesh?.dataset.mesh;
    for (let i = 0; i < 10; i++) frame(100);
    expect(mesh?.dataset.mesh).not.toBe(before);
  });

  it("dragging her out of the pill places her as now", () => {
    const { el, eris, edits, frame } = track(mount());
    eris.setState("done");
    frame();
    expectOut(el);
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          isPrimary: true,
          button: 0,
          clientX: x,
          clientY: y,
        }),
      );
    fire("pointerdown", 500, 600);
    fire("pointermove", 450, 550);
    fire("pointermove", 400, 500);
    fire("pointerup", 400, 500);
    const to = { x: ABOVE.x - 100, y: ABOVE.y - 100 };
    expect(edits).toEqual([{ op: "move-eris", at: to }]);
    eris.setState("idle");
    frame();
    frame(RETURN_MS + 16);
    frame(2000);
    expect(resting(el)).toBe(false);
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(at(el)).toEqual(px(to));
  });

  it("under reduced motion she comes and goes on the same frame", () => {
    const { el, eris, frame, clock } = track(mount({ reduced: true }));
    frame();
    expect(el.dataset.motion).toBe("none");
    expect(resting(el)).toBe(true);
    eris.setState("oops");
    frame();
    expect(resting(el)).toBe(false);
    eris.setState("idle");
    frame();
    clock.advance(RETURN_MS - 1);
    expect(resting(el)).toBe(false);
    clock.advance(1);
    expect(resting(el)).toBe(true);
    expect(el.dataset.motion).toBe("none");
  });

  it("with no talk pill she rests where she rests today", () => {
    const { el, frame } = track(mount({ pill: false }));
    frame();
    frame(2000);
    expect(resting(el)).toBe(false);
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.hasAttribute("aria-hidden")).toBe(false);
    expect(at(el)).toEqual(px({ x: Math.round((window.innerWidth - BODY.width) / 2), y: 40 }));
  });
});
