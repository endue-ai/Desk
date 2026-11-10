// Compositor mode for the app e2e (#56): the desk runs with DESK_COMPOSITOR=1, so every plugin
// surface is an off-screen browser the compositor draws, and input reaches it only through the
// compositor's router. The machine running the specs may have its screen locked, so a spec feeds
// the compositor window winit's events through the CEF shell's development command
// `compositor_input` (the same entry the event loop uses, `compositor_window/harness.rs`) and reads
// the result in the surface's own page: each surface is a DevTools page target, a window handle
// here. Positions are the window's logical pixels.
import { join } from "node:path";
import { browser } from "@wdio/globals";

/** The app's environment for a compositor spec: the mode, and the input and drag fixtures. */
export function compositorEnv(root: string): Record<string, string> {
  const fixtures = ["plugin-e2e-input", "plugin-e2e-drag"].map((f) =>
    join(root, "e2e/fixtures", f),
  );
  return {
    DESK_COMPOSITOR: "1",
    DESK_DEV_PLUGINS: fixtures.join(process.platform === "win32" ? ";" : ":"),
  };
}

/** The input fixture's surface and the drag fixture's. */
export const INPUT = "main.e2e-input";
export const DRAG = "main.e2e-drag";

/** Call a CEF shell command from the desk's main page and wait for its answer. */
export async function shellCommand<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const answer = await browser.execute(
    (cmd: string, args: Record<string, unknown>) =>
      new Promise((resolve) => {
        const native = (globalThis as unknown as { __deskNative: DeskNative }).__deskNative;
        const id = 900_000 + Math.floor(Math.random() * 99_999);
        const original = native.onMessage;
        const timer = setTimeout(() => resolve({ error: `${cmd}: no answer` }), 15_000);
        native.onMessage = (text: string) => {
          const message = JSON.parse(text) as { id?: number; ok?: unknown; error?: string };
          if (message.id !== id) return original(text);
          native.onMessage = original;
          clearTimeout(timer);
          resolve(message.error ? { error: message.error } : { ok: message.ok });
        };
        native.send(JSON.stringify({ id, cmd, args }));
      }),
    cmd,
    args,
  );
  const { ok, error } = answer as { ok?: T; error?: string };
  if (error) throw new Error(error);
  return ok as T;
}

interface DeskNative {
  send(text: string): void;
  onMessage: (text: string) => void;
}

/** Hand the compositor window these events, as winit would. */
export const feed = (events: unknown[], options: { osPointer?: boolean } = {}) =>
  shellCommand<{ fed: number }>("compositor_input", { logical: true, events, ...options });

export interface InputState {
  focused: string | null;
  cursor: string;
  ime: {
    allowed: boolean;
    area: number[] | null;
    composing: { surface: string; text: string } | null;
  };
  drag: {
    active: boolean;
    over: string | null;
    effect: string | null;
    overlay: { caption: string } | null;
  };
  pointer: { capture: string | null; hearing: string[] };
}

export const inputState = () => shellCommand<InputState>("compositor_input_state");

interface Placed {
  pieces: number[][];
  rect: number[] | null;
}

/** Where `local` (a point of surface `host`'s own) is in the window, if nothing covers it there. */
export async function pointIn(
  host: string,
  local: [number, number],
): Promise<[number, number] | undefined> {
  const { surfaces } = await shellCommand<{ surfaces: Record<string, Placed> }>("compositor_stats");
  const placed = surfaces[host];
  const [left, top] = placed?.rect ?? [];
  if (!placed || left === undefined || top === undefined) return undefined;
  const [x, y] = [left + local[0], top + local[1]];
  const shown = placed.pieces.some(
    ([px = 0, py = 0, w = 0, h = 0]) => x >= px && x < px + w && y >= py && y < py + h,
  );
  return shown ? [x, y] : undefined;
}

/** Any point of surface `host` nothing covers, the middle of its largest visible piece. */
export async function visiblePoint(host: string): Promise<[number, number] | undefined> {
  const { surfaces } = await shellCommand<{ surfaces: Record<string, Placed> }>("compositor_stats");
  const pieces = [...(surfaces[host]?.pieces ?? [])].sort(
    (a, b) => (b[2] ?? 0) * (b[3] ?? 0) - (a[2] ?? 0) * (a[3] ?? 0),
  );
  const [x = 0, y = 0, w = 0, h = 0] = pieces[0] ?? [];
  return pieces[0] ? [x + w / 2, y + h / 2] : undefined;
}

/** A click at window point `at`. */
export const click = (at: [number, number]) =>
  feed([
    { type: "pointerMoved", x: at[0], y: at[1] },
    { type: "pointerButton", button: "left", pressed: true },
    { type: "pointerButton", button: "left", pressed: false },
  ]);

/** Bring surface `host`'s window to the front with a click on a part of it nothing covers, until
 * `local` shows. */
export async function raise(host: string, local: [number, number]): Promise<[number, number]> {
  let at = await pointIn(host, local);
  for (let tries = 0; !at && tries < 5; tries++) {
    const visible = await visiblePoint(host);
    if (!visible) throw new Error(`${host} shows nowhere`);
    await click(visible);
    await browser.pause(400);
    at = await pointIn(host, local);
  }
  if (!at) throw new Error(`${host}'s point ${local} stays covered`);
  return at;
}

/** Evaluate `expression` in plugin surface `host`'s own page, then go back to the main page. */
export async function inSurface<T>(host: string, expression: string): Promise<T> {
  const main = await browser.getWindowHandle();
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    if ((await browser.getUrl()).startsWith(`desk-plugin://${host}/`)) {
      try {
        return (await browser.execute(`return (${expression})`)) as T;
      } finally {
        await browser.switchToWindow(main);
      }
    }
  }
  await browser.switchToWindow(main);
  throw new Error(`no page of ${host}`);
}

/** A key going down then up, with text when it types some. */
export const keyPress = (key: string, code: string, text?: string) => [
  { type: "key", key, code, ...(text ? { text } : {}), pressed: true },
  { type: "key", key, code, pressed: false },
];
