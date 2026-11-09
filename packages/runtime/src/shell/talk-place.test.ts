// @vitest-environment jsdom
// The talk pill moves where the person drags it (desk.shell.talk-place): folded by the pill itself,
// open by its grip only, kept inside the app as it grows, its lists below it when it sits high up;
// a double-click on the grip or desk.shell.talk-home puts it back on the bottom edge.
import { afterEach, describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import type { CommandSpec } from "../commands";
import { Settings } from "../settings";
import { mountComposer } from "./Composer";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { emptyState, Store } from "./state";
import { mountTalkChrome } from "./TalkChrome";
import { PLACE, pillBox, placeAt, placeOf } from "./talk-place";
import { Ticker } from "./ticker";

const APP = { vw: 1440, vh: 900 };

describe("where the pill is drawn", () => {
  it("at its bottom centre, inside the app however it grows", () => {
    expect(pillBox({ x: 0.5, y: 0.5 }, "idle", APP)).toEqual({
      left: 628,
      bottom: 450,
      w: 184,
      h: 48,
      high: false,
    });
    // Near the right edge it grows leftwards; open, it keeps 8 px from the edge.
    expect(pillBox({ x: 0.99, y: 0.95 }, "idle", APP).left).toBe(1440 - 184 - 8);
    expect(pillBox({ x: 0.99, y: 0.95 }, "hover", APP).left).toBe(1440 - 400 - 8);
    expect(pillBox({ x: 0.99, y: 0.95 }, "edit", APP)).toMatchObject({
      left: 1440 - 640 - 8,
      h: 72,
    });
    // At the very top it stays its height plus the margin below the app's top, its lists below it.
    expect(pillBox({ x: 0.5, y: 0 }, "edit", APP)).toMatchObject({
      bottom: 900 - 72 - 8,
      high: true,
    });
    expect(pillBox({ x: 0.5, y: 1 }, "idle", APP).bottom).toBe(8);
  });

  it("keeps a place as shares of the app, and reads only a well-formed one", () => {
    expect(placeAt(720, 450, APP)).toEqual({ x: 0.5, y: 0.5 });
    expect(placeAt(-50, 2000, APP)).toEqual({ x: 0, y: 1 });
    expect(placeOf({ x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3 });
    for (const bad of [
      undefined,
      null,
      {},
      { x: 2, y: 0.5 },
      { x: "1", y: 0 },
      { x: Number.NaN, y: 0 },
    ])
      expect(placeOf(bad)).toBeNull();
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

function setup() {
  const root = document.createElement("footer");
  document.body.append(root);
  const store = new Store(emptyState("en"));
  const ticker = new Ticker(new ManualClock());
  const settings = new Settings();
  const defined = new Map<string, CommandSpec>();
  const commands = {
    list: () => [],
    has: (id: string) => defined.has(id),
    define: (id: string, spec: CommandSpec) => {
      defined.set(id, spec);
      return () => defined.delete(id);
    },
    run: (id: string) => Promise.resolve(defined.get(id)?.run(undefined, {})),
  };
  const keymap = { bindings: () => [], onChange: () => () => {} };
  const ctx = {
    store,
    ticker,
    reduced: () => false,
    platform: "mac",
    keyOf: () => undefined,
    tr: (key: Parameters<typeof t>[1]) => t("en", key),
    runtime: { commands, settings, keymap, focusSurface: () => {} },
    bridge: { agents: { card: async () => ({}) } },
  } as unknown as ShellCtx;
  cleanups.push(mountComposer(root, ctx), mountTalkChrome(root, ctx), () => ticker.dispose());
  const pill = root.querySelector<HTMLElement>(".talk-pill");
  if (!pill) throw new Error("no pill");
  return { root, pill, store, settings, commands };
}

function drag(target: Element, dx: number, dy: number) {
  const fire = (type: string, x: number, y: number) =>
    target.dispatchEvent(
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
  fire("pointerdown", 0, 0);
  fire("pointermove", dx / 2, dy / 2);
  fire("pointermove", dx, dy);
  fire("pointerup", dx, dy);
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("dragging the pill", () => {
  it("folded, the pill moves where it is dropped, and the drop does not open it", () => {
    const { root, pill, store, settings } = setup();
    // jsdom's app is 1024 × 768 and lays nothing out: the pill starts at the origin.
    drag(root.querySelector(".talk-launch") as Element, 512, 384);
    expect(settings.get(PLACE)).toEqual({ x: 0.5, y: 0.5 });
    expect(pill.classList.contains("is-placed")).toBe(true);
    expect(pill.style.left).toBe(`${512 - 92}px`);
    expect(pill.style.bottom).toBe("384px");
    expect(store.get().composer.open).toBe(false);
  });

  it("open, only the grip moves it: pressing the text line types", () => {
    const { root, pill, settings } = setup();
    (root.querySelector(".talk-launch") as HTMLButtonElement).click();
    drag(root.querySelector(".composer-input") as Element, 300, 100);
    expect(settings.get(PLACE, null)).toBeNull();
    drag(root.querySelector(".talk-grip") as Element, 300, 100);
    expect(placeOf(settings.get(PLACE))).not.toBeNull();
    expect(pill.dataset.state).toBe("edit");
  });

  it("goes back to the bottom edge on a double-click on the grip and on desk.shell.talk-home", async () => {
    const { root, pill, settings, commands } = setup();
    settings.set(PLACE, { x: 0.2, y: 0.1 });
    expect(pill.classList.contains("is-high")).toBe(true);
    root.querySelector(".talk-grip")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(settings.get(PLACE, null)).toBeNull();
    expect(pill.classList.contains("is-placed")).toBe(false);
    expect(pill.style.left).toBe("");
    settings.set(PLACE, { x: 0.8, y: 0.9 });
    expect(pill.classList.contains("is-placed")).toBe(true);
    await commands.run("desk.shell.talk-home");
    expect(pill.classList.contains("is-placed")).toBe(false);
  });
});
