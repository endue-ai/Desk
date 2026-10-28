/// <reference types="vite/client" />
/** Assemble mode folders (modes/<id>/mode.json, layout/desktop-N.json, ...) into `Mode` objects. */
import type { DesktopIndex, Mode } from "./types";

export function modesFromFiles(files: Record<string, unknown>): Mode[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(files)) {
    const match = /([^/]+)\/((?:layout\/)?[^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, id = "", file = ""] = match;
    const entry = byId.get(id) ?? {};
    entry[file] = (data as { default?: unknown }).default ?? data;
    byId.set(id, entry);
  }
  const modes: Mode[] = [];
  for (const entry of byId.values()) {
    const desktops: Mode["desktops"] = {};
    for (const n of [1, 2, 3, 4] as DesktopIndex[]) {
      const layout = entry[`layout/desktop-${n}`];
      if (layout) desktops[n] = layout as Mode["desktops"][DesktopIndex];
    }
    modes.push({
      manifest: entry.mode as Mode["manifest"],
      desktop: entry["layout/desktop"] as Mode["desktop"],
      desktops,
      plugins: (entry.plugins ?? { enabled: [], settings: {} }) as Mode["plugins"],
      roles: (entry.roles ?? { roles: [] }) as Mode["roles"],
      eris: entry.eris as Mode["eris"],
      triggers: (entry.triggers ?? { manual: true }) as Mode["triggers"],
    });
  }
  const order = ["base", "morning", "deep-work", "review", "studio", "night"];
  return modes.sort((a, b) => order.indexOf(a.manifest.id) - order.indexOf(b.manifest.id));
}

/** The five sample modes plus base, bundled at build time. */
export function sampleModes(): Mode[] {
  return modesFromFiles(import.meta.glob("./sample/**/*.json", { eager: true }));
}
