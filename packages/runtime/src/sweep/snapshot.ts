/**
 * A sweep's snapshot (ADR 0296): the area as the person sees it, put together from each window's
 * last frame (ui.surface.snapshot) over the desk's background, saved as a PNG under
 * ~/.desk/snapshots, and said in words for Eris: the area, the windows in it and where the picture
 * is. Her brains read text only (specs/brain), so the words are what she reads; the picture is the
 * person's, and the chip above the talk line shows it.
 */
import type { ShellBridge } from "../bridge/types";
import { type Box, type SweepContext, windowLines } from "./model";

export interface Seen {
  id: string;
  title: string;
  plugin: string;
  /** Its box on screen, in CSS pixels from the desk's top left. */
  box: Box;
}

/** The file name of a snapshot taken at `at`: endue-snapshot-2026-11-21-23-40-05.png. */
export function snapshotName(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `endue-snapshot-${day}-${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}.png`;
}

/** What Eris reads of a snapshot. */
export function snapshotText(area: Box, windows: readonly Seen[], path?: string): string {
  const where = `${Math.round(area.w)}×${Math.round(area.h)} at ${Math.round(area.x)},${Math.round(area.y)}`;
  const lines = [
    `[The person took a snapshot of an area of the desk (${where}) and asks about it.]`,
    windows.length > 0
      ? `Windows in it:\n${windowLines(windows)}`
      : "No window is in it: only the empty desk.",
  ];
  if (path) lines.push(`The picture is saved at ${path}.`);
  return lines.join("\n");
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the snapshot did not load"));
    image.src = src;
  });

/**
 * The area as a PNG data: URL, at the screen's scale: the desk's background, then each window's
 * frame in its box (the part inside the area). A window without a frame stays background.
 */
export async function composeSnapshot(
  bridge: Pick<ShellBridge, "snapshots">,
  area: Box,
  windows: readonly Seen[],
  background: string,
  scale = globalThis.devicePixelRatio || 1,
): Promise<string | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(area.w * scale));
  canvas.height = Math.max(1, Math.round(area.h * scale));
  const draw = canvas.getContext("2d");
  if (!draw) return undefined;
  draw.fillStyle = background;
  draw.fillRect(0, 0, canvas.width, canvas.height);
  for (const window of windows) {
    const shot = await bridge.snapshots?.window(window.plugin).catch(() => null);
    if (!shot) continue;
    const image = await load(`data:image/png;base64,${shot.image}`).catch(() => undefined);
    if (!image) continue;
    const { box } = window;
    draw.drawImage(
      image,
      (box.x - area.x) * scale,
      (box.y - area.y) * scale,
      box.w * scale,
      box.h * scale,
    );
  }
  return canvas.toDataURL("image/png");
}

/** Take the snapshot, save it, and say it for Eris. */
export async function takeSnapshot(
  bridge: Pick<ShellBridge, "snapshots">,
  area: Box,
  windows: readonly Seen[],
  background: string,
  now = new Date(),
): Promise<SweepContext> {
  const image = await composeSnapshot(bridge, area, windows, background).catch(() => undefined);
  const base64 = image?.slice(image.indexOf(",") + 1);
  const path =
    base64 && bridge.snapshots
      ? await bridge.snapshots.save(snapshotName(now), base64).catch(() => undefined)
      : undefined;
  const count = windows.length;
  const label = `Snapshot · ${count} window${count === 1 ? "" : "s"}`;
  return {
    label,
    text: snapshotText(area, windows, path),
    ...(image ? { image } : {}),
    ...(path ? { path } : {}),
  };
}
