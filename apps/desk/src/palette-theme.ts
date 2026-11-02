// The native palette window follows the desk's theme (ADR 0056, TH-08). Only the main window runs the
// runtime that resolves the theme, so it keeps the theme in force in the app's storage, which both
// windows share (one origin, one data store). The palette host reads it when it starts, hears each
// change as a `storage` event, and reads it again whenever it opens; it applies the theme to its own
// root and passes it on to its frame as desk:theme. No window needs a new capability for this.

/** Where the main window keeps the theme in force for the palette window. */
export const KEPT_THEME = "desk.palette.theme";

/** The desk:theme payload a frame gets (@endue-ai/plugin-sdk's ThemeState). */
export interface DeskTheme {
  scheme: "light" | "dark";
  contrast: "normal" | "high";
  reducedMotion: boolean;
  variables: Record<string, string>;
  fonts?: Array<{ family: string; url: string; weight?: string; style?: string }>;
}

/** The main window's runtime, as far as the palette needs it. */
export interface ThemeSource {
  theme(): DeskTheme;
  themes: { onChange(listener: () => void): () => void };
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** The window's storage, or none where it is unavailable (an opaque origin, for example). */
function storageOf(win: Window): Store | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}

/** Main window: keep the theme in force for the palette window, now and on every change. */
export function sendThemeToPalette(
  source: ThemeSource,
  storage: Pick<Storage, "setItem"> | undefined = storageOf(window),
): () => void {
  let last = "";
  const send = () => {
    const { scheme, contrast, reducedMotion, variables, fonts = [] } = source.theme();
    const text = JSON.stringify({ scheme, contrast, reducedMotion, variables, fonts });
    if (text === last) return;
    last = text;
    try {
      storage?.setItem(KEPT_THEME, text);
    } catch {
      // Storage full: the palette keeps the theme it has until the next change fits.
    }
  };
  const off = source.themes.onChange(send);
  send();
  return off;
}

/** Whether a value is a theme payload; what storage holds is checked before it is used. */
function isTheme(value: unknown): value is DeskTheme {
  const theme = value as Partial<DeskTheme> | null;
  return (
    typeof theme === "object" &&
    theme !== null &&
    (theme.scheme === "light" || theme.scheme === "dark") &&
    (theme.contrast === "normal" || theme.contrast === "high") &&
    typeof theme.reducedMotion === "boolean" &&
    typeof theme.variables === "object" &&
    theme.variables !== null &&
    (theme.fonts === undefined || Array.isArray(theme.fonts))
  );
}

function parse(text: string | null | undefined): DeskTheme | undefined {
  try {
    const value: unknown = JSON.parse(text ?? "null");
    return isTheme(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Apply a theme to a root: its --desk-* tokens, and data-scheme, data-contrast and data-motion. */
export function applyDeskTheme(root: HTMLElement, theme: DeskTheme): void {
  const names = Object.keys(theme.variables).filter((name) => name.startsWith("--desk-"));
  // Tokens an earlier theme set and this one lacks would otherwise linger.
  const stale = Array.from({ length: root.style.length }, (_, i) => root.style.item(i)).filter(
    (name) => name.startsWith("--desk-") && !names.includes(name),
  );
  for (const name of stale) root.style.removeProperty(name);
  for (const name of names) root.style.setProperty(name, theme.variables[name] ?? "");
  root.dataset.scheme = theme.scheme;
  root.dataset.contrast = theme.contrast;
  root.dataset.motion = theme.reducedMotion ? "reduce" : "full";
}

/** The palette host's handle: `hello` when its frame says desk:hello, `refresh` when it opens. */
export interface FollowedTheme {
  hello(): void;
  refresh(): void;
  dispose(): void;
}

/**
 * Palette window: follow the theme the main window keeps. The host's root takes it at once; the frame
 * gets it as desk:theme on hello and on every change after.
 */
export function followDeskTheme(
  host: { root: HTMLElement; post(message: unknown): void },
  win: Window = window,
): FollowedTheme {
  let current = "";
  let theme: DeskTheme | undefined;
  let greeted = false;
  const use = (text: string | null | undefined) => {
    const next = parse(text);
    if (!next || text === current) return;
    current = text ?? "";
    theme = next;
    applyDeskTheme(host.root, next);
    if (greeted) host.post({ type: "desk:theme", theme: next });
  };
  const read = () => use(storageOf(win)?.getItem(KEPT_THEME));
  // Another window's change to the app's storage: here, the main window's theme.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEPT_THEME) use(event.newValue);
  };
  win.addEventListener("storage", onStorage);
  read();
  return {
    hello() {
      greeted = true;
      if (theme) host.post({ type: "desk:theme", theme });
    },
    refresh: read,
    dispose: () => win.removeEventListener("storage", onStorage),
  };
}
