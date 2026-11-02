// @vitest-environment jsdom
// The native palette window follows the desk's theme (ADR 0056, TH-08, #343): the theme the main
// window announces reaches the palette host, its own root and its frame as desk:theme.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeskTheme, sendThemeToPalette } from "./palette-theme";

type Handler = (event: { event: string; id: number; payload: unknown }) => void;
// The native events the palette window hears (palette://open, bridge://event).
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    listen: vi.fn(async (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return () => set.delete(handler);
    }),
    fire(event: string) {
      for (const handler of handlers.get(event) ?? []) handler({ event, id: 1, payload: null });
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

/**
 * The app's storage, which both windows share, as the main window writes it: the browser tells every
 * other window of the origin with a storage event a moment later (here the palette's is this window).
 */
const sharedStorage = {
  setItem(key: string, value: string) {
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, value);
    const init = { key, oldValue, newValue: value, storageArea: localStorage };
    queueMicrotask(() => window.dispatchEvent(new StorageEvent("storage", init)));
  },
};

const DARK: DeskTheme = {
  scheme: "dark",
  contrast: "normal",
  reducedMotion: false,
  variables: { "--desk-card": "#1e1d21", "--desk-text": "#ededf0", "--desk-glow": "#5b4bff" },
  fonts: [],
};
const LIGHT: DeskTheme = {
  scheme: "light",
  contrast: "normal",
  reducedMotion: false,
  variables: { "--desk-card": "#ffffff", "--desk-text": "#1b1b1f" },
  fonts: [],
};
const LIGHT_HIGH: DeskTheme = {
  scheme: "light",
  contrast: "high",
  reducedMotion: true,
  variables: { "--desk-card": "#ffffff", "--desk-text": "#000000" },
  fonts: [{ family: "Plex", url: "desk-plugin://localhost/acme.theme/plex.woff2", weight: "400" }],
};

/** The main window's runtime: the theme in force, with the fields only the main UI reads. */
function mainWindow(initial: DeskTheme) {
  const listeners = new Set<() => void>();
  let state = initial;
  return {
    theme: () => ({ ...state, tokens: { card: "#000" }, themes: ["endue.dark"], fixes: [] }),
    themes: {
      onChange(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    change(next: DeskTheme) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Start the palette window's host (palette.ts) and watch what it posts to its frame. */
async function paletteWindow() {
  document.body.innerHTML = '<div id="desk"></div>';
  vi.resetModules();
  await import("./palette");
  const frame = document.querySelector("iframe");
  const win = frame?.contentWindow;
  if (!win) throw new Error("The palette host made no frame");
  const posted: Array<{ type?: string }> = [];
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message as { type?: string });
  });
  return {
    root: document.documentElement,
    say: (data: unknown) =>
      window.dispatchEvent(new MessageEvent("message", { data, source: win })),
    themes: () => posted.filter((message) => message.type === "desk:theme"),
  };
}

beforeEach(() => {
  tauri.handlers.clear();
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  for (const name of ["scheme", "contrast", "motion"])
    delete document.documentElement.dataset[name];
});

describe("the native palette window follows the desk's theme", () => {
  it("passes the theme the main window announces to its frame on hello and on every change", async () => {
    const palette = await paletteWindow();
    const main = mainWindow(LIGHT);
    const stop = sendThemeToPalette(main, sharedStorage);
    await vi.waitFor(() => expect(palette.root.dataset.scheme).toBe("light"));
    expect(palette.themes()).toEqual([]);

    palette.say({ type: "desk:hello" });
    expect(palette.themes()).toEqual([{ type: "desk:theme", theme: LIGHT }]);

    main.change(LIGHT_HIGH);
    await vi.waitFor(() => expect(palette.themes()).toHaveLength(2));
    expect(palette.themes()[1]).toEqual({ type: "desk:theme", theme: LIGHT_HIGH });

    main.change(DARK);
    await vi.waitFor(() => expect(palette.themes()).toHaveLength(3));
    expect(palette.themes()[2]).toEqual({ type: "desk:theme", theme: DARK });
    stop();
  });

  it("keeps the last theme for a palette window that starts after it was sent", async () => {
    const main = mainWindow(DARK);
    sendThemeToPalette(main, sharedStorage);
    main.change(LIGHT);

    const palette = await paletteWindow();
    expect(palette.root.dataset.scheme).toBe("light");
    palette.say({ type: "desk:hello" });
    expect(palette.themes()).toEqual([{ type: "desk:theme", theme: LIGHT }]);
  });

  it("gives the host's own root the variables, data-scheme, contrast and motion", async () => {
    const palette = await paletteWindow();
    const main = mainWindow(DARK);
    sendThemeToPalette(main, sharedStorage);
    await vi.waitFor(() => expect(palette.root.dataset.scheme).toBe("dark"));
    expect(palette.root.style.getPropertyValue("--desk-card")).toBe("#1e1d21");
    expect(palette.root.style.getPropertyValue("--desk-glow")).toBe("#5b4bff");

    main.change(LIGHT_HIGH);
    await vi.waitFor(() => expect(palette.root.dataset.scheme).toBe("light"));
    expect(palette.root.dataset.contrast).toBe("high");
    expect(palette.root.dataset.motion).toBe("reduce");
    expect(palette.root.style.getPropertyValue("--desk-card")).toBe("#ffffff");
    expect(palette.root.style.getPropertyValue("--desk-text")).toBe("#000000");
    // A token the new theme lacks does not linger from the old one.
    expect(palette.root.style.getPropertyValue("--desk-glow")).toBe("");
  });

  it("reads the kept theme again when it opens, in case a change went unheard", async () => {
    const palette = await paletteWindow();
    palette.say({ type: "desk:hello" });
    // Kept without a storage event reaching this window.
    sendThemeToPalette(mainWindow(LIGHT), localStorage);
    await Promise.resolve();
    expect(palette.root.dataset.scheme).toBeUndefined();

    tauri.fire("palette://open");
    expect(palette.root.dataset.scheme).toBe("light");
    expect(palette.themes()).toEqual([{ type: "desk:theme", theme: LIGHT }]);
    tauri.fire("palette://open");
    expect(palette.themes()).toHaveLength(1);
  });

  it("stops sending once the main window lets go", async () => {
    const palette = await paletteWindow();
    const main = mainWindow(DARK);
    const stop = sendThemeToPalette(main, sharedStorage);
    palette.say({ type: "desk:hello" });
    await vi.waitFor(() => expect(palette.themes()).toHaveLength(1));
    stop();
    main.change(LIGHT);
    await Promise.resolve();
    await Promise.resolve();
    expect(palette.themes()).toHaveLength(1);
    expect(palette.root.dataset.scheme).toBe("dark");
  });
});
