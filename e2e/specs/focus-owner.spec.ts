// One owner of focus (#251, ADR 0230): desk-wm decides which window is in use, the compositor's
// router reads it for the keys and the desk's page follows it. After every step (a press on a
// window's surface, a press on a title bar, Ctrl+Tab, a command, an agent's call) the window the
// window manager has in use, the surface the keys go to and the element the page's focus is on name
// the same window. Nothing here waits by a timer: a step ends with the answer it calls for (the
// shell's answer to the input fed, the desk desk-wm publishes for the runtime's edit, the command's
// answer), and the three are read in that same turn, never polled until they agree.
// The pointer and the keys are winit's, fed to the compositor window (support/compositor.ts): the
// screen may be locked. Commands run over the desk's socket as `desk cmd run`, Eris's tools and an
// MCP client run them (cmd.invoke).
import assert from "node:assert/strict";
import { browser } from "@wdio/globals";
import { feed, keyPress, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import { deskNow, onScreen, type Rect, run, type Window } from "../support/windows";

interface InUse {
  window: string | null;
  pane: string | null;
  plugin: string | null;
  surface: string | null;
}

/** The owner's word, the keys' target and where the page's focus is. */
interface Focus {
  inUse: InUse;
  keys: string | null;
  dom: { surface: string | null; own: boolean };
}

interface DeskNative {
  send(text: string): void;
  onMessage: (text: string) => void;
}

/**
 * Send the shell `events` (none: only read), and read the three holders once it answered; with
 * `edited`, once desk-wm also published the desk a runtime's edit made (the edit a key's command
 * asks for). The answer and that desk reach the page behind what the step itself sent it, in order.
 */
async function step(events: unknown[] = [], edited = false): Promise<Focus> {
  const read = await browser.execute(
    (events: unknown[], edited: boolean) =>
      new Promise((resolve) => {
        const native = (globalThis as unknown as { __deskNative: DeskNative }).__deskNative;
        const original = native.onMessage;
        const feeding = 800_000 + Math.floor(Math.random() * 9_999);
        const reading = feeding + 10_000;
        let waits = (events.length ? 1 : 0) + (edited ? 1 : 0);
        const send = (id: number, cmd: string, args: unknown) =>
          native.send(JSON.stringify({ id, cmd, args }));
        const next = () => {
          waits -= 1;
          if (waits === 0) send(reading, "compositor_input_state", {});
        };
        native.onMessage = (text: string) => {
          const message = JSON.parse(text) as {
            id?: number;
            ok?: { focused: string | null; inUse: unknown };
            error?: string;
            event?: string;
            payload?: { answered?: unknown };
          };
          if (message.id === feeding) return message.error ? resolve(message) : next();
          if (message.id === reading) {
            native.onMessage = original;
            const active = document.activeElement;
            const section = active?.closest<HTMLElement>(".desk-surface[data-surface]");
            const rests = !active || active === document.body || active.matches("[data-surface]");
            const dom = { surface: section?.dataset.surface ?? null, own: !section && !rests };
            return resolve({ inUse: message.ok?.inUse, keys: message.ok?.focused, dom });
          }
          original(text);
          const answered = message.event === "desk://compositor-wm" && message.payload?.answered;
          if (edited && answered && waits > 0) next();
        };
        if (events.length) send(feeding, "compositor_input", { logical: true, events });
        else send(reading, "compositor_input_state", {});
      }),
    events,
    edited,
  );
  const { error } = read as { error?: string };
  if (error) throw new Error(error);
  return read as Focus;
}

const hostOf = (plugin: string) => `main.${plugin.replace(".", "-")}`;

/** `actual` is `expected`, or the step named in `after` broke the agreement. */
function same(actual: unknown, expected: unknown, after: string, now: Focus): void {
  assert.deepStrictEqual(actual, expected, `${after}: ${JSON.stringify(now)}`);
}

/** The three name one window: the one the window manager has in use. */
function agrees(now: Focus, after: string): void {
  const { inUse, keys, dom } = now;
  assert.ok(inUse.window, `${after}: no window in use`);
  // The keys are with the surface that shows the pane in use (the page while none does).
  same(keys, inUse.surface ?? "desk", `${after}, the keys`, now);
  // The page's focus is on that plugin's section, or on nothing of its own for a pane it draws.
  same(dom, { surface: inUse.plugin, own: false }, `${after}, the page's focus`, now);
}

/** The same, and the window is `plugin`'s, its own surface with the keys. */
function inUseIs(now: Focus, plugin: string, after: string): void {
  agrees(now, after);
  same(now.inUse.window, plugin, `${after}, the window in use`, now);
  same(now.inUse.plugin, plugin, `${after}, the plugin in use`, now);
  same(now.keys, hostOf(plugin), `${after}, the keys`, now);
}

const click = (at: { x: number; y: number }) => [
  { type: "pointerMoved", x: at.x, y: at.y },
  { type: "pointerButton", button: "left", pressed: true },
  { type: "pointerButton", button: "left", pressed: false },
];

const inside = (r: Rect, at: { x: number; y: number }) =>
  at.x >= r.x && at.x < r.x + r.w && at.y >= r.y && at.y < r.y + r.h;

/**
 * A point of window `w` no window in front of it covers, away from the desk's own bars at the
 * app's edges: in its title bar (`title`), else in its body.
 */
function clearPoint(w: Window, all: Window[], screen: { w: number; h: number }, title: boolean) {
  const above = all.filter((o) => o.id !== w.id && (o.z ?? 0) > (w.z ?? 0));
  const ys = title ? [w.y + 20] : [w.y + 80, w.y + w.h / 2, w.y + w.h - 30];
  for (const y of ys) {
    for (let x = w.x + 50; x < w.x + w.w - (title ? 180 : 20); x += 15) {
      const at = { x, y };
      const clear = x > 90 && x < screen.w - 90 && y > 70 && y < screen.h - 130;
      if (clear && !above.some((o) => inside(o, at))) return at;
    }
  }
  return undefined;
}

/**
 * A window of one plugin, other than `not`, whose surface the compositor draws now and which shows
 * a clear point where a press is wanted; and that point.
 */
async function pick(not: string[], title: boolean) {
  type Placed = { pieces: number[][] };
  const { surfaces } = await shellCommand<{ surfaces: Record<string, Placed> }>("compositor_stats");
  const desk = await deskNow();
  const all = onScreen(desk);
  for (const w of all) {
    const live = (surfaces[hostOf(w.id)]?.pieces.length ?? 0) > 0;
    const plain = w.panes.length === 1 && w.panes[0]?.plugin === w.id;
    const at = live && plain && !not.includes(w.id) && clearPoint(w, all, desk.screen, title);
    if (at) return { id: w.id, at };
  }
  throw new Error(`no window besides ${not.join(", ")} shows a clear ${title ? "title" : "body"}`);
}

describe("one owner of focus", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    // The desk as it starts: whatever is in use, the three agree before anything is done.
    await run("desk.windows.list");
  });

  it("the window in use, the keys and the page's focus agree after every step", async () => {
    // A command first, so a known window is in use.
    const start = await pick([], false);
    await run("desk.windows.focus", { window: start.id });
    inUseIs(await step(), start.id, "desk.windows.focus");

    // A press on another window's surface.
    const body = await pick([start.id], false);
    inUseIs(await step(click(body.at)), body.id, `a press on ${body.id}'s surface`);

    // A press on a third window's title bar, which the desk's page hears.
    const title = await pick([body.id], true);
    inUseIs(await step(click(title.at)), title.id, `a press on ${title.id}'s title bar`);

    // Ctrl+Tab: the next window in the focus order, whichever it is.
    const before = await step();
    const tab = [{ type: "modifiers", ctrl: true }, ...keyPress("Tab", "Tab", "\t")];
    const tabbed = await step([...tab, { type: "modifiers" }], true);
    agrees(tabbed, "Ctrl+Tab");
    assert.notEqual(tabbed.inUse.window, before.inUse.window, "Ctrl+Tab moved nothing");

    // A command that shows a plugin's window.
    await run("desk.display.show", { plugin: body.id });
    inUseIs(await step(), body.id, "desk.display.show");

    // An agent's call: the command Eris's desk.windows tool and an MCP client invoke.
    await run("desk.windows.focus", { window: start.id });
    inUseIs(await step(), start.id, "an agent's desk.windows.focus");

    // And a press again, right after: the page follows without having been asked.
    const again = await pick([start.id], false);
    inUseIs(await step(click(again.at)), again.id, `a press on ${again.id} after a command`);
    // What is typed now goes to that window: nothing holds it for the page.
    const { keys } = await shellCommand<{ keys: { holding: boolean } }>("compositor_input_state");
    assert.equal(keys.holding, false, "what is typed after a press in a window waits");
  });
});
