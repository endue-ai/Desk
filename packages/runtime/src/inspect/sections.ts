/**
 * The inspector's sections only the runtime can answer, besides the render tree (`tree.ts`): the
 * surfaces with their plugin, the host's views, the buffer list and the live frames (ADR 0134); and
 * every setting with the value in force and the layer that won, by desk.describe's resolution
 * (`describe/setting.ts`, ADR 0017). Plain data out.
 */
import type { PluginInfo } from "@endue-ai/bridge";
import type { Buffer } from "../buffers";
import { held, settingInForce } from "../describe/setting";
import type { Facts } from "../describe/words";
import type { Frames } from "../frames/install";
import type { Layer } from "../settings";
import type { SurfaceHost } from "../surfaces";
import type { HostViews } from "../views";

export interface InspectedSetting {
  key: string;
  value: unknown;
  /** The layer whose value is in force; `default` is the manifest's. */
  layer: Layer | "default";
  /** The plugin that declares it, when one does. */
  owner?: string;
  /** Values a layer holds that do not fit the declaration, lowest layer first. */
  skipped?: Array<{ layer: Layer; value: unknown }>;
}

/** Every setting a plugin declares or a layer holds, by key. */
export function settingsSection(f: Pick<Facts, "declared" | "layers">): InspectedSetting[] {
  const keys = new Set([
    ...Object.keys(f.declared),
    ...Object.values(f.layers).flatMap((values) => Object.keys(values)),
  ]);
  return [...keys].sort().map((key) => {
    const declared = f.declared[key];
    const inForce = settingInForce(key, f);
    const skipped = held(key, f)
      .filter((h) => !h.fits)
      .map(({ layer, value }) => ({ layer, value }));
    return {
      key,
      value: inForce ? inForce.value : declared?.default,
      layer: inForce?.layer ?? "default",
      ...(declared ? { owner: declared.owner } : {}),
      ...(skipped.length > 0 ? { skipped } : {}),
    };
  });
}

export interface InspectedSurface {
  id: string;
  /** The installed plugin it belongs to. */
  plugin?: string;
  title: string;
  /** `grid`, `overlay`, an edge (`left`, `right`, `bottom`) or `window` (the shell's windows). */
  placement: string;
  visible: boolean;
  focused: boolean;
  /** Its frame is unloaded, its state kept, until it shows again (ADR 0070, ADR 0134). */
  asleep: boolean;
}

/** The live frames: how many are loaded, and of the windows how many out of sight and asleep. */
export interface InspectedFrames {
  /** Surfaces whose frame is loaded, edge bars and overlays included. */
  live: number;
  /** Windows whose frame is loaded while out of sight: what desk.surfaces.live bounds. */
  hidden: number;
  /** Windows asleep. */
  asleep: number;
  /** desk.surfaces.live in force. */
  budget: number;
}

export interface SurfacesInput {
  host: SurfaceHost;
  /** The surface the keys go to. */
  focused: string | null;
  plugins: readonly PluginInfo[];
  views?: Pick<HostViews, "ids" | "title" | "focused">;
  buffers: Buffer[];
  /** The frame policy, for the windows' live frames. */
  frames?: Pick<Frames, "counts">;
}

/**
 * The surfaces in the order they opened, the host's views, the buffers (most recent first) and the
 * live frames.
 */
export function surfacesSection({ host, focused, plugins, views, buffers, frames }: SurfacesInput) {
  const installed = new Set(plugins.map((p) => p.id));
  const surfaces: InspectedSurface[] = host.ids().map((id) => {
    const section = host.get(id);
    return {
      id,
      ...(installed.has(id) ? { plugin: id } : {}),
      title: section?.querySelector("iframe")?.title ?? id,
      placement: placementOf(section),
      visible: host.visible(id),
      focused: focused === id,
      asleep: host.unloaded(id),
    };
  });
  const inUse = views?.focused() ?? null;
  const shown = (views?.ids() ?? []).map((id) => ({
    id,
    title: views?.title(id) ?? id,
    focused: inUse === id,
  }));
  const counts = frames?.counts();
  const live: InspectedFrames | undefined = counts && {
    live: surfaces.filter((s) => !s.asleep).length,
    hidden: counts.hidden,
    asleep: counts.asleep,
    budget: counts.budget,
  };
  return { surfaces, views: shown, buffers, ...(live ? { frames: live } : {}) };
}

function placementOf(section: HTMLElement | undefined): string {
  if (section?.classList.contains("desk-surface--overlay")) return "overlay";
  // A section the runtime left detached for the shell's window host (ADR 0040).
  if (section?.classList.contains("desk-surface--windowed")) return "window";
  return /desk-edge--(\w+)/.exec(section?.parentElement?.className ?? "")?.[1] ?? "center";
}
