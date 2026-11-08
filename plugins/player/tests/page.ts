// The player's real page in jsdom: ui/index.html's body, the real view and the real controller on the
// SDK's test host. jsdom does not play media, so the two media elements get stand-ins for play(),
// pause(), paused, duration and error that a test drives.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import { createView } from "../ui/view.js";
import { type MountOptions, mount } from "./harness";

export interface FakeMedia {
  paused: boolean;
  duration: number;
  error: { code: number } | null;
  element: HTMLMediaElement;
  /** Fire one of the element's events, as WebKit would. */
  fire(type: string): void;
}

function fakeMedia(element: HTMLMediaElement, duration: number): FakeMedia {
  const media: FakeMedia = {
    paused: true,
    duration,
    error: null,
    element,
    fire: (type) => element.dispatchEvent(new Event(type)),
  };
  Object.defineProperty(element, "paused", { get: () => media.paused, configurable: true });
  Object.defineProperty(element, "duration", { get: () => media.duration, configurable: true });
  Object.defineProperty(element, "error", { get: () => media.error, configurable: true });
  element.play = vi.fn(async () => {
    media.paused = false;
    media.fire("play");
  });
  element.pause = vi.fn(() => {
    media.paused = true;
    media.fire("pause");
  });
  element.load = vi.fn();
  element.canPlayType = () => "maybe";
  return media;
}

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const views = new Set<ReturnType<typeof createView>>();

afterEach(() => {
  // A test can mount several pages; detached media still owns its playback interval.
  for (const view of views) view.show(null);
  views.clear();
});

/** Mount the page: `duration` is what both media elements report once they have a source. */
export async function mountPage(options: MountOptions & { duration?: number } = {}) {
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  document.body.className = "";
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const video = fakeMedia(byId<HTMLVideoElement>("video"), options.duration ?? 100);
  const audio = fakeMedia(byId<HTMLAudioElement>("audio"), options.duration ?? 100);
  let app: Record<string, (...args: unknown[]) => unknown> | undefined;
  const view = createView(document, (name, ...args) => app?.[name]?.(...args));
  views.add(view);
  const mounted = await mount({ ...options, view });
  app = mounted.app as unknown as Record<string, (...args: unknown[]) => unknown>;
  /** Press a key where the focus is (the body when nothing has it). */
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
  };
  return { ...mounted, video, audio, byId, press };
}
