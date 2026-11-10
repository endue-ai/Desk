/**
 * Surfaces are stored in the 1440×900 reference frame. Where a window is on the app, in which
 * space, how it fills and how far it may move or grow are the window manager's (crates/desk-wm
 * `geometry.rs`, `coordinates.rs`, #83): the page reads each window's place from what it published.
 */

export const REF = { width: 1440, height: 900 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
