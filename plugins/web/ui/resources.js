// What a page uses, gathered before it is drawn: its style sheets (<link rel="stylesheet">,
// <style>, @import three levels deep), images (src, srcset, poster, background, CSS url()) and
// inline styles. Each resolves through the page's resolver (the disk around it, or the archive it
// came from) and is inlined as a data: URL or a <style>, up to 20 MB in all. Remote resources are
// never fetched; they, missing files and what passed the limits are counted.
import { charsetOf, dataUrl, decodeText, imageType, isImageData, latin1 } from "./bytes.js";
import { cleanSheet, cleanStyle, cssRefs } from "./css.js";

/**
 * @typedef {import("./formats.js").Resolver} Resolver
 * @typedef {{ remote: number, missing: number, limit: number }} Left
 */

export const BUDGET = 20 * 1024 * 1024;
const IMPORT_DEPTH = 3;
const PARALLEL = 6;

/** Subtrees the sanitizer drops whole: nothing in them is loaded. */
const DROPPED = new Set([
  "noscript",
  "template",
  "foreignobject",
  "annotation-xml",
  "noframes",
  "audio",
  "object",
  "embed",
  "iframe",
]);
const dropped = (/** @type {Element} */ el) => {
  for (let at = el.parentElement; at; at = at.parentElement)
    if (DROPPED.has(at.localName.toLowerCase())) return true;
  return false;
};

/** A media attribute that cannot break out of the @media rule it is put in. */
const media = (/** @type {string} */ css, /** @type {string | null} */ query) => {
  const text = query?.trim() ?? "";
  if (!text || text.toLowerCase() === "all") return css;
  return /^[\w\s(),:.\-/]*$/.test(text) ? `@media ${text} {${css}}` : "";
};

/** The best candidate of a srcset: the largest up to 2x (or 1600w), else the smallest. */
export function bestCandidate(/** @type {string} */ srcset) {
  /** @type {Array<{ url: string, density: number }>} */
  const candidates = [];
  const n = srcset.length;
  for (let i = 0; i < n; ) {
    while (i < n && /[\s,]/.test(srcset[i] ?? "")) i++;
    if (i >= n) break;
    let j = i;
    while (j < n && !/\s/.test(srcset[j] ?? "")) j++;
    let url = srcset.slice(i, j);
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
      i = j;
    } else {
      let depth = 0;
      let k = j;
      for (; k < n && !(srcset[k] === "," && depth === 0); k++) {
        if (srcset[k] === "(") depth++;
        else if (srcset[k] === ")") depth--;
      }
      descriptor = srcset.slice(j, k).trim();
      i = k + 1;
    }
    const value = Number.parseFloat(descriptor) || 1;
    candidates.push({ url, density: descriptor.endsWith("w") ? value / 800 : value });
  }
  const fitting = candidates.filter((c) => c.density <= 2).sort((a, b) => b.density - a.density);
  return (fitting[0] ?? candidates.sort((a, b) => a.density - b.density)[0])?.url;
}

/**
 * @param {Document} doc an inert document
 * @param {Resolver} resolver
 * @param {number} [budget]
 */
export async function collect(doc, resolver, budget = BUDGET) {
  /** @type {Left} */
  const left = { remote: 0, missing: 0, limit: 0 };
  /** URLs already counted, so a resource used twice is counted once. */
  const counted = new Set();
  const leave = (/** @type {string} */ url, /** @type {keyof Left} */ why) => {
    if (counted.has(url)) return;
    counted.add(url);
    left[why]++;
  };
  let spent = 0;
  const base = resolver.base;

  // Loads start in the order they are asked for, a few at a time.
  let active = 0;
  /** @type {Array<() => void>} */
  const waiting = [];
  /** @type {Map<string, Promise<import("./formats.js").Loaded | "remote" | "missing">>} */
  const loads = new Map();
  const load = (/** @type {string} */ url) => {
    let pending = loads.get(url);
    if (!pending) {
      pending = (async () => {
        while (active >= PARALLEL) await new Promise((go) => waiting.push(() => go(undefined)));
        active++;
        try {
          return await resolver.load(url);
        } finally {
          active--;
          waiting.shift()?.();
        }
      })().catch(() => /** @type {const} */ ("missing"));
      loads.set(url, pending);
    }
    return pending;
  };
  const resolve = (/** @type {string} */ ref, /** @type {string} */ from) => {
    const text = ref.trim();
    if (!text || text.startsWith("#") || /^data:/i.test(text)) return undefined;
    try {
      const url = new URL(text, from);
      url.hash = "";
      return url.href;
    } catch {
      return undefined;
    }
  };

  /** @type {Map<string, string | null>} */
  const images = new Map();
  /** An image as a data: URL, or why it is left out (not yet counted). */
  const image = async (/** @type {string} */ url) => {
    const known = images.get(url);
    if (known) return known;
    const got = await load(url);
    if (got === "remote" || got === "missing") return /** @type {const} */ ([got, url]);
    const type = imageType(got.bytes, got.type, url);
    if (!type) return /** @type {const} */ (["missing", url]);
    if (spent + got.bytes.length > budget) return /** @type {const} */ (["limit", url]);
    spent += got.bytes.length;
    const data = dataUrl(type, got.bytes);
    images.set(url, data);
    return data;
  };
  /** The first candidate that loads; when none does, the first one's reason is counted. */
  const firstImage = async (/** @type {string[]} */ refs, /** @type {string} */ from) => {
    /** @type {readonly [keyof Left, string] | undefined} */
    let reason;
    for (const ref of refs) {
      const url = resolve(ref, from);
      if (!url) continue;
      const got = await image(url);
      if (typeof got === "string") return got;
      reason ??= got;
    }
    if (reason) leave(reason[1], reason[0]);
    return null;
  };
  const cssUrl = (/** @type {string} */ ref, /** @type {string} */ from) => {
    const text = ref.trim();
    if (text.startsWith("#") || isImageData(text)) return text;
    const url = resolve(text, from);
    return url ? (images.get(url) ?? null) : null;
  };

  /** A sheet's CSS with its imports inlined and its images loaded, cleaned. */
  const processCss = async (
    /** @type {string} */ text,
    /** @type {string} */ from,
    /** @type {number} */ depth,
  ) => {
    const refs = cssRefs(text);
    /** @type {Map<string, string | null>} */
    const imported = new Map();
    for (const ref of refs.imports) {
      const url = resolve(ref, from);
      if (!url) continue;
      if (depth >= IMPORT_DEPTH) leave(url, "limit");
      else imported.set(url, await sheet(url, depth + 1));
    }
    const urls = refs.urls.map((ref) => resolve(ref, from)).filter((url) => url !== undefined);
    for (const url of urls) void load(url);
    for (const url of urls) await firstImage([url], from);
    return cleanSheet(text, {
      url: (ref) => cssUrl(ref, from),
      imported: (ref) => {
        const url = resolve(ref, from);
        return url ? (imported.get(url) ?? null) : null;
      },
    });
  };
  /** @returns {Promise<string | null>} */
  const sheet = async (/** @type {string} */ url, /** @type {number} */ depth) => {
    const got = await load(url);
    if (got === "remote" || got === "missing") {
      leave(url, got);
      return null;
    }
    if (spent + got.bytes.length > budget) {
      leave(url, "limit");
      return null;
    }
    spent += got.bytes.length;
    const declared =
      charsetOf(got.type) ?? /^@charset "([^"]+)";/.exec(latin1(got.bytes, 0, 64))?.[1];
    return processCss(decodeText(got.bytes, { declared, sniff: false }).text, url, depth);
  };

  /** @type {string[]} */
  const sheets = [];
  for (const el of doc.querySelectorAll("link, style")) {
    if (dropped(el)) continue;
    if (el.localName.toLowerCase() === "style") {
      sheets.push(media(await processCss(el.textContent ?? "", base, 0), el.getAttribute("media")));
      continue;
    }
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    if (!rel.includes("stylesheet") || rel.includes("alternate") || el.hasAttribute("disabled"))
      continue;
    const url = resolve(el.getAttribute("href") ?? "", base);
    const css = url ? await sheet(url, 0) : null;
    if (css !== null) sheets.push(media(css, el.getAttribute("media")));
  }

  /** @type {Map<Element, string>} */
  const styles = new Map();
  for (const el of doc.querySelectorAll("[style]")) {
    if (dropped(el)) continue;
    const text = el.getAttribute("style") ?? "";
    for (const ref of cssRefs(text, "declarations").urls) await firstImage([ref], base);
    styles.set(el, cleanStyle(text, { url: (ref) => cssUrl(ref, base) }));
  }

  /** @type {Array<[Element, string[]]>} */
  const wanted = [];
  for (const el of doc.querySelectorAll("img, input, video, body, table, td, th, image")) {
    if (dropped(el)) continue;
    const name = el.localName.toLowerCase();
    const attr = (/** @type {string} */ n) => el.getAttribute(n) ?? "";
    /** @type {string[]} */
    let refs = [];
    if (name === "img") {
      const sources =
        el.parentElement?.localName === "picture"
          ? [...el.parentElement.querySelectorAll("source[srcset]")]
          : [];
      refs = [
        bestCandidate(attr("srcset")),
        attr("src"),
        ...sources.map((s) => bestCandidate(s.getAttribute("srcset") ?? "")),
      ].filter((r) => r !== undefined && r !== "");
    } else if (name === "input") refs = attr("type").toLowerCase() === "image" ? [attr("src")] : [];
    else if (name === "video") refs = [attr("poster")];
    else if (name === "image")
      refs = [attr("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || ""];
    else refs = [attr("background")];
    refs = refs.filter(Boolean);
    if (refs.length) wanted.push([el, refs]);
  }
  for (const [, refs] of wanted) {
    const url = resolve(refs[0] ?? "", base);
    if (url) void load(url);
  }
  /** @type {Map<Element, string>} */
  const pictures = new Map();
  for (const [el, refs] of wanted) {
    const data = await firstImage(refs, base);
    if (data) pictures.set(el, data);
  }

  return {
    sheets,
    left,
    /** The cleaned style attribute of an element of `doc`. */
    style: (/** @type {Element} */ el) => styles.get(el),
    /** The data: URL an image element of `doc` draws. */
    picture: (/** @type {Element} */ el) => pictures.get(el),
  };
}
