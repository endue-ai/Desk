import { t } from "../../strings/index.js";
// The page's imager (imager.js): the theme's colour tokens resolved to sRGB values by drawing each
// on a 1x1 canvas (any colour syntax the theme writes comes out as #rrggbb), the mono font and its
// size as computed; a PNG drawn from the export's SVG on a canvas, scaled down when the asked size
// is past what a canvas holds; and a PNG onto the clipboard through the Clipboard API.

/**
 * @typedef {import("./svg.js").Palette} Palette
 * @typedef {import("./imager.js").Imager} Imager
 */

/** The largest side and area a canvas draws in the engines the desk runs. */
export const SIDE = 16_384;
export const AREA = 16_384 * 16_384;

/** The tokens each colour of the palette reads. */
const TOKENS = /** @type {const} */ ({
  background: "--desk-background",
  card: "--desk-card",
  border: "--desk-border",
  head: "--desk-muted",
  text: "--desk-text",
  key: "--desk-primary-text",
  muted: "--desk-text-muted",
  line: "--desk-text-muted",
});

const hex = (/** @type {number} */ v) => v.toString(16).padStart(2, "0");
/** A computed sRGB colour: rgb(r, g, b), rgba(r, g, b, a) or rgb(r g b / a). */
const RGB = /^rgba?\(([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\)$/u;

/** The scale a PNG of `width` × `height` is drawn at: the one asked, or the largest that fits. */
export function fittingScale(
  /** @type {number} */ width,
  /** @type {number} */ height,
  /** @type {number} */ scale,
) {
  return Math.min(scale, SIDE / width, SIDE / height, Math.sqrt(AREA / (width * height)));
}

/** @param {Document} doc @returns {Imager} */
export function createImager(doc) {
  const win = /** @type {Window} */ (doc.defaultView);
  /** A computed colour as #rrggbb (#rrggbbaa when not opaque); a canvas reads other syntaxes. */
  const value = (/** @type {string} */ color) => {
    if (!color.trim()) return color;
    const rgb = RGB.exec(color.trim());
    if (rgb) {
      const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => Math.round(Number(v)));
      const alpha = rgb[4] ? Number.parseFloat(rgb[4]) / (rgb[4].endsWith("%") ? 100 : 1) : 1;
      const a = Math.round(alpha * 255);
      return `#${hex(r ?? 0)}${hex(g ?? 0)}${hex(b ?? 0)}${a < 255 ? hex(a) : ""}`;
    }
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return color;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ""}`;
  };
  /** A token's colour as computed on the probe, or as the root declares it where nothing computes. */
  const colorOf = (/** @type {HTMLElement} */ probe, /** @type {string} */ token) => {
    probe.style.color = `var(${token})`;
    const computed = win.getComputedStyle(probe).color;
    const declared = win.getComputedStyle(doc.documentElement).getPropertyValue(token).trim();
    return value(computed && !computed.includes("var(") ? computed : declared || computed);
  };

  return {
    palette() {
      const probe = doc.createElement("span");
      probe.className = "er-probe";
      probe.setAttribute("aria-hidden", "true");
      (doc.body ?? doc.documentElement).append(probe);
      try {
        /** @type {Record<string, string>} */
        const out = {};
        for (const [name, token] of Object.entries(TOKENS)) out[name] = colorOf(probe, token);
        probe.style.font = "var(--desk-text-xs) var(--desk-font-mono)";
        const style = win.getComputedStyle(probe);
        out.font = style.fontFamily || "monospace";
        out.size = style.fontSize || "12px";
        return /** @type {Palette} */ (/** @type {unknown} */ (out));
      } finally {
        probe.remove();
      }
    },
    async png(svg, width, height, scale) {
      const fitted = fittingScale(width, height, scale);
      const image = new win.Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = doc.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * fitted));
      canvas.height = Math.max(1, Math.round(height * fitted));
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("features.diagram.image.thisPageCannotDrawAPng"));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL("image/png");
      return { base64: url.slice(url.indexOf(",") + 1), scale: fitted };
    },
    async copy(base64) {
      const clipboard = win.navigator?.clipboard;
      const Item = /** @type {any} */ (win).ClipboardItem;
      if (typeof clipboard?.write !== "function" || typeof Item !== "function") return false;
      const bytes = Uint8Array.from(win.atob(base64), (c) => c.charCodeAt(0));
      try {
        await clipboard.write([
          new Item({ "image/png": new Blob([bytes], { type: "image/png" }) }),
        ]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
