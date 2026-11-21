// A diagram as an image (PG-55): Export as SVG (vector, the theme's colours and font as values) or
// PNG at 1x or 2x, written where the person picks in the desk's save dialog (dialog.save), with one
// perm.request when the desk refuses the write (ADR 0260: the manifest's fs:write of /** declares
// it); or a PNG copied to the clipboard. The image holds the diagram alone (svg.js). No DOM: the
// page's imager (imager.js) resolves the colours and draws the PNG.

import { withGrant, writeScope } from "../../console-files.js";
import { imagerOf } from "./imager.js";
import { documentOf, sizeOfDocument } from "./svg.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("./controller.js").Target} Target
 * @typedef {"svg" | "png" | "png2x"} Format
 */

const FORMATS = /** @type {const} */ (["svg", "png", "png2x"]);
const EXT = { svg: "svg", png: "png", png2x: "png" };
const NAMES = { svg: "SVG", png: "PNG", png2x: "PNG at 2x" };

const imager = () => {
  const found = imagerOf();
  if (!found) throw new Error("This page cannot draw the diagram as an image.");
  return found;
};

/** The diagram's SVG document, its size and the name it is saved under. */
export function imageOf(/** @type {Target} */ t) {
  const title = `${t.conn.name} · ${t.state.id}`;
  const svg = documentOf(t.state.layout, imager().palette(), `ER diagram: ${title}`);
  return { svg, size: sizeOfDocument(t.state.layout), base: `er-${t.conn.name}-${t.state.id}` };
}

/** A file name with the format's extension, safe on every file system. */
const fileName = (/** @type {string} */ base, /** @type {Format} */ format) => {
  const safe = base
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 80);
  return `${safe || "er-diagram"}.${EXT[format]}`;
};

/** The image's bytes: the SVG as text, a PNG as base64 (and the scale it was drawn at). */
async function contentOf(/** @type {Target} */ t, /** @type {Format} */ format) {
  const { svg, size } = imageOf(t);
  if (format === "svg") return { content: svg, encoding: "utf8", scale: 1 };
  const want = format === "png2x" ? 2 : 1;
  const png = await imager().png(svg, size.w, size.h, want);
  return { content: png.base64, encoding: "base64", scale: png.scale, want };
}

/**
 * Export a diagram where the person picks (or to `args.path`).
 * @param {Deps} deps
 * @param {Target} t
 * @param {{ format?: unknown, path?: unknown }} args
 */
export async function exportDiagram(deps, t, args) {
  const format = FORMATS.includes(/** @type {Format} */ (args.format))
    ? /** @type {Format} */ (args.format)
    : /** @type {Format | undefined} */ (
        await deps.pick("Database: export the ER diagram as", [
          { id: "svg", label: "SVG", detail: "Vector, in the theme's colours" },
          { id: "png", label: "PNG", detail: "At its size on screen" },
          { id: "png2x", label: "PNG at 2x", detail: "Twice as sharp" },
        ])
      );
  if (!format) throw deps.cancelled("Not exported.");
  const { base } = imageOf(t);
  let path = typeof args.path === "string" && args.path ? args.path : "";
  if (!path) {
    const picked = await deps.bridge.call("dialog.save", {
      title: "Export the ER diagram",
      suggestedName: fileName(base, format),
      filters: [{ name: `${NAMES[format]} image`, extensions: [EXT[format]] }],
    });
    if (picked.cancelled || !picked.path) throw deps.cancelled("Not exported.");
    path = picked.path;
  }
  const { content, encoding, scale, want } = await contentOf(t, format);
  const scope = writeScope(path);
  await withGrant(
    deps.bridge,
    scope,
    () =>
      deps.bridge.call("fs.write", {
        path,
        content,
        encoding: /** @type {"utf8" | "base64"} */ (encoding),
        scope,
      }),
    `To export the ER diagram to ${path}`,
  );
  const smaller =
    want && scale < want ? ` (drawn at ${scale.toFixed(2)}x, the largest that fits)` : "";
  deps.say(`Exported the diagram as ${NAMES[format]} to ${path}${smaller}.`);
  return { path, format, scale };
}

/** Copy a diagram onto the clipboard as a PNG. */
export async function copyDiagram(/** @type {Deps} */ deps, /** @type {Target} */ t) {
  const { content } = await contentOf(t, "png");
  const done = await imager().copy(content);
  deps.say(
    done
      ? "Copied the diagram as an image."
      : "Could not copy the diagram: the desk did not let the page write images to the clipboard.",
  );
  return done;
}
