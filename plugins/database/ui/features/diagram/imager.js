// What draws a diagram as an image in the page (image.js): the theme's colours and font as values,
// a PNG from the export's SVG, and a PNG onto the clipboard. ui/main.js provides it, so the feature's
// commands export without a DOM of their own; tests provide their own.

/**
 * @typedef {{
 *   palette(): import("./svg.js").Palette,
 *   png(svg: string, width: number, height: number, scale: number): Promise<{ base64: string, scale: number }>,
 *   copy(base64: string): Promise<boolean>,
 * }} Imager
 *   `png` answers the image as base64 and the scale it was drawn at (less than asked past the
 *   canvas's size); `copy` false when the clipboard refused.
 */

/** @type {Imager | undefined} */
let provided;

/** Set the page's imager (ui/main.js), or none. */
export const provideImager = (/** @type {Imager | undefined} */ imager) => {
  provided = imager;
};
/** The page's imager, or undefined where nothing draws (a test that gave none). */
export const imagerOf = () => provided;
