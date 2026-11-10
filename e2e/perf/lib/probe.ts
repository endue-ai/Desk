// The input-latency probe. A key is timed in the shell page, from its keydown there (its
// `timeStamp`, when the page got the event) to the animation frame after the one in which its
// change was first seen, by when that change was painted. WebKitWebDriver delivers the keys; the
// OS's own input path before the page is not in the number.
//
// A key reaches the shell page only while the page itself has the keyboard. With a plugin surface's
// place focused (ADR 0160), the key goes to the surface, whose SDK forwards it to the desk as a
// `desk:key` message from that surface's host: the desk acts on it, but there is no keydown in the
// shell page to time. So each press first takes the keyboard, and a press that still went through a
// surface is named and pressed again.
//
// takeKeyboard, armProbe, readProbe and paletteShown run in the shell page: support/probe.ts hands
// each one whole to browser.execute, so they use the page's globals only, never a name from this
// module or an import. Unit tested in probe.test.ts (jsdom).

/** What a key is expected to change: the palette's surface shown, or the focus moved. */
export type Change = "palette" | "focus";

/** What an armed probe saw (window.__deskProbe). */
export interface Probe {
  /** From the key's keydown in the shell page to the frame after its change was first seen. */
  ms?: number;
  /** The surface whose frame had the keyboard: the key reached the desk through it, untimed. */
  frame?: string;
}

/**
 * Give the keyboard to the shell page; the surface whose place kept it, or null. The body takes the
 * focus, focusable for that moment (as packages/runtime/src/frames/settle.ts does).
 */
export function takeKeyboard(): string | null {
  const { body } = document;
  const tabbable = body.hasAttribute("tabindex");
  if (!tabbable) body.tabIndex = -1;
  body.focus({ preventScroll: true });
  if (!tabbable) body.removeAttribute("tabindex");
  const place = document.activeElement?.closest("[data-surface-host]");
  if (!place) return null;
  return place.closest("[data-surface]")?.getAttribute("data-surface") ?? "a plugin";
}

/**
 * Get ready for the next key that is not a bare modifier: time it if the shell page hears it, or
 * name the frame it went through once its change showed (so it can be undone and pressed again).
 */
export function armProbe(change: Change): void {
  const probe: Probe = {};
  (window as unknown as { __deskProbe: Probe }).__deskProbe = probe;
  const before = document.activeElement;
  const changed =
    change === "palette"
      ? () => {
          const section = document.querySelector<HTMLElement>(
            '.desk-surface[data-surface="desk.palette"]',
          );
          return section !== null && !section.hidden;
        }
      : () => document.activeElement !== before;
  const modifier = (key: unknown) => ["Control", "Shift", "Alt", "Meta"].includes(String(key));
  const once = (seen: (painted: number) => void) => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("message", onMessage, true);
    const watch = () => requestAnimationFrame(changed() ? seen : watch);
    requestAnimationFrame(watch);
  };
  const onKey = (event: KeyboardEvent) => {
    if (modifier(event.key)) return;
    // When the event arrived; should its clock ever not be the page's, when it is handled.
    const handled = performance.now();
    const start = event.timeStamp > 0 && event.timeStamp <= handled ? event.timeStamp : handled;
    once((painted) => {
      probe.ms = painted - start;
    });
  };
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; key?: { key?: unknown } } | null;
    if (data?.type !== "desk:key" || modifier(data.key?.key)) return;
    // A surface's message comes from its host (packages/runtime/src/pages/remote.ts).
    const host = /^desk-plugin:\/\/([^/?#]+)/.exec(event.origin)?.[1];
    const place = host ? document.querySelector(`[data-surface-host="${host}"]`) : null;
    const surface = place?.closest("[data-surface]")?.getAttribute("data-surface");
    once(() => {
      probe.frame = surface ?? "a plugin";
    });
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("message", onMessage, true);
}

/** What the armed probe saw so far. */
export function readProbe(): Probe {
  return (window as unknown as { __deskProbe?: Probe }).__deskProbe ?? {};
}

/** Whether the palette's surface is shown (armProbe looks for the same section). */
export function paletteShown(): boolean {
  const section = document.querySelector<HTMLElement>('.desk-surface[data-surface="desk.palette"]');
  return section !== null && !section.hidden;
}

/** How many times a key that went through a frame is pressed again. */
export const PRESS_AGAIN = 2;

/**
 * Press until the shell page times a press: its time, and the frames the presses before it went
 * through. `press` presses once and undoes what the key changed, so it can run again.
 */
export async function pressUntilTimed(
  press: () => Promise<Probe>,
  what: string,
): Promise<{ ms: number; throughFrames: string[] }> {
  const throughFrames: string[] = [];
  for (let n = 0; n <= PRESS_AGAIN; n++) {
    const probe = await press();
    if (typeof probe.ms === "number") return { ms: probe.ms, throughFrames };
    throughFrames.push(probe.frame ?? "a plugin");
  }
  const last = throughFrames[throughFrames.length - 1];
  throw new Error(
    `${what}: the key went to ${last}'s frame, not the shell page, ${throughFrames.length} times`,
  );
}
