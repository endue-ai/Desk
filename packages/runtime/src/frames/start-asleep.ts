/**
 * Which plugins start asleep (#590, ADR 0070): mounted with the commands, keys and palette entries
 * their manifest declares, but no surface until their first use (a command, a request, a launch).
 * With a saved session to put back, that is every enabled UI plugin that is not autoload, whose
 * surface is a window and that the session does not show. A window is a centre or floating
 * surface; on a desk whose window host holds the side surfaces too (the shell's: only overlays and
 * the bottom bar stay the runtime's), a left or right one is a window as well, so a side window the
 * person closed stays closed (issue 163, finding 3). Edge bars in sight and overlays, which must
 * open at once, mount; an autoload plugin that is on was turned on for a file (ADR 0046). Without a
 * session to put back nothing starts asleep.
 */
import type { PluginInfo } from "@endue-ai/bridge";
import { autoloads } from "../policy";

/** Placements of a surface that is a window: what a restored layout shows, or does not. */
const WINDOWS = new Set([undefined, "center", "floating"]);
/** What a window host leaves the runtime (`openSurface`): every other placement is a window. */
const NOT_WINDOWS = new Set(["overlay", "bottom"]);

export interface AsleepOptions {
  /** The desk has a window host: its side surfaces are windows too. */
  windows?: boolean;
}

/** The plugins of `plugins` that start asleep, given what the saved session shows (undefined: none). */
export function startsAsleep(
  plugins: readonly PluginInfo[],
  shown: ReadonlySet<string> | undefined,
  options: AsleepOptions = {},
): Set<string> {
  if (!shown) return new Set();
  const windowed = (placement: string | undefined) =>
    options.windows ? !NOT_WINDOWS.has(placement ?? "center") : WINDOWS.has(placement);
  const asleep = plugins.filter(
    (p) =>
      p.status === "ready" &&
      p.enabled &&
      p.manifest?.kind === "ui" &&
      !autoloads(p) &&
      windowed(p.manifest.surfaces?.[0]?.placement) &&
      !shown.has(p.id),
  );
  return new Set(asleep.map((p) => p.id));
}
