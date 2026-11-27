// The map's model (NET-04): the router in the middle cell of an odd grid, every other device online
// in the cells around it, nearest ring first and clockwise from the top, so the drawing reads like a
// floor plan with the router at its heart. Pure: the view draws what this returns.

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {{ device: Device, row: number, col: number, ring: number }} Cell
 * @typedef {{ cols: number, rows: number, center: { row: number, col: number }, router: Device | null,
 *   cells: Cell[], away: number }} MapModel
 */

/** More devices than this on one map are listed after it, in the device list. */
export const MAP_MAX = 80;

/** The smallest odd grid, as square as fits, with room for `n` devices and the router. @param {number} n */
export function gridFor(n) {
  let side = 3;
  while (side * side < n + 1) side += 2;
  let rows = side;
  while (rows - 2 >= 3 && side * (rows - 2) >= n + 1) rows -= 2;
  return { cols: side, rows };
}

/**
 * @param {Device[]} devices
 * @returns {MapModel}
 */
export function mapModel(devices) {
  const online = devices.filter((d) => d.online);
  const router = online.find((d) => d.gateway) ?? devices.find((d) => d.gateway) ?? null;
  const others = online.filter((d) => d !== router).slice(0, MAP_MAX);
  const { cols, rows } = gridFor(others.length);
  const center = { row: (rows - 1) / 2, col: (cols - 1) / 2 };
  /** @type {Array<{ row: number, col: number, ring: number, near: number, angle: number }>} */
  const slots = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      if (row === center.row && col === center.col) continue;
      const dr = row - center.row;
      const dc = col - center.col;
      const ring = Math.max(Math.abs(dr), Math.abs(dc));
      // Clockwise from straight up.
      const angle = (Math.atan2(dc, -dr) + 2 * Math.PI) % (2 * Math.PI);
      slots.push({ row, col, ring, near: Math.hypot(dr, dc), angle });
    }
  // Nearest ring first, and within a ring the cells nearest the router, so both sides fill evenly.
  slots.sort((a, b) => a.ring - b.ring || a.near - b.near || a.angle - b.angle);
  // The person's own devices and the known ones sit nearest the router; new and caution ones after.
  const order = { known: 0, new: 1, caution: 2 };
  const placed = [...others].sort(
    (a, b) =>
      Number(b.self) - Number(a.self) ||
      Number(b.mine) - Number(a.mine) ||
      order[a.status] - order[b.status],
  );
  const cells = placed.map((device, i) => ({
    device,
    row: slots[i].row,
    col: slots[i].col,
    ring: slots[i].ring,
  }));
  return {
    cols,
    rows,
    center,
    router,
    cells,
    away: devices.filter((d) => !d.online && !d.gateway).length,
  };
}
