/**
 * Which plugins start asleep (#590, ADR 0070): mounted with the commands, keys and palette entries
 * their manifest declares, but no surface until their first use (a command, a request, a launch).
 * With a saved session to put back, that is every enabled UI plugin that is not autoload, whose
 * surface is a window (centre or floating) and that the session does not show. Edge bars are always
 * in sight and overlays must open at once, so they mount; an autoload plugin that is on was turned
 * on for a file (ADR 0046). Without a session to put back nothing starts asleep.
 */
import type { PluginInfo } from "@endue-ai/bridge";
import { autoloads } from "../policy";

/** Placements of a surface that is a window: what a restored layout shows, or does not. */
const WINDOWS = new Set([undefined, "center", "floating"]);

/** The plugins of `plugins` that start asleep, given what the saved session shows (undefined: none). */
export function startsAsleep(
  plugins: readonly PluginInfo[],
  shown: ReadonlySet<string> | undefined,
): Set<string> {
  if (!shown) return new Set();
  const asleep = plugins.filter(
    (p) =>
      p.status === "ready" &&
      p.enabled &&
      p.manifest?.kind === "ui" &&
      !autoloads(p) &&
      WINDOWS.has(p.manifest.surfaces?.[0]?.placement) &&
      !shown.has(p.id),
  );
  return new Set(asleep.map((p) => p.id));
}
