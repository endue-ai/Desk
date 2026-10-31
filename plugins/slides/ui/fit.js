// The scale that fits a slide in an area, keeping its aspect ratio. No DOM.

/**
 * @param {{ width: number, height: number }} area
 * @param {{ width: number, height: number }} size
 * @returns {{ scale: number, width: number, height: number }}
 */
export function scaleToFit(area, size) {
  const w = size.width || 1;
  const h = size.height || 1;
  // An area not laid out yet (0 x 0) draws the slide at a quarter until it is measured.
  const scale =
    area.width > 0 && area.height > 0 ? Math.min(area.width / w, area.height / h) : 0.25;
  return { scale, width: w * scale, height: h * scale };
}
