// openDjvu: a DjVu file's pages, text and outline. Single pages (FORM:DJVU, PM44, BM44), bundled
// documents (FORM:DJVM, its DIRM directory with every component inside) and indirect ones (the
// directory only, the pages in files beside it). DjVu v3 specification, sections 7 and 8.3.

import { bzz } from "./bzz.js";
import { chunksIn, dataOf, outerForm, readForm, u16, u32 } from "./iff.js";
import { pageChunks, pageInfo, renderForm } from "./page.js";
import { annotationTitle, outline as readOutline, pageText as readText } from "./text.js";

/**
 * @typedef {import("./iff.js").Source} Source
 * @typedef {import("./page.js").Form} Form
 * @typedef {import("./text.js").Outline} Outline
 * @typedef {{ width: number, height: number, dpi: number, rotation: number, missing?: string }} Page
 * Sizes are as the page shows, after its rotation (degrees clockwise); `missing` names the
 * separate file an indirect document keeps the page in, when it could not be opened.
 * @typedef {{ id: string, name: string, title: string, type: number, offset: number }} Component
 * `type`: 0 included, 1 page, 2 thumbnails, 3 shared annotations; `offset` in a bundled file
 */

const PAGE = 1;
const ANNOTATIONS = 3;
const KEEP = 6;

/**
 * Opens a DjVu file. `resolve`, when given, opens the separate files of an indirect document by
 * name; without it (or when it answers null) those pages are listed as missing.
 * @param {Source} source
 * @param {{ resolve?: (name: string) => Promise<Source | null> }} [options]
 */
export async function openDjvu(source, { resolve } = {}) {
  const outer = await outerForm(source);
  /** @type {Component[]} */
  let components;
  let bundled = true;
  /** @type {Form | null} */
  let top = null;
  if (outer.kind === "DJVU" || outer.kind === "PM44" || outer.kind === "BM44") {
    components = [{ id: "", name: "", title: "", type: PAGE, offset: outer.offset }];
  } else if (outer.kind === "DJVM") {
    top = await readForm(source, outer.offset);
    const dirm = chunksIn(top.bytes, 12)[0];
    if (dirm?.id !== "DIRM") throw new Error("The document has no DIRM directory first.");
    ({ components, bundled } = directory(dataOf(top.bytes, dirm)));
  } else {
    throw new Error(`This file holds a FORM:${outer.kind}, which is not a DjVu page or document.`);
  }

  /** @type {Map<Component, Promise<Form>>} */
  const forms = new Map();
  /** @type {Map<Component, Promise<Source | null>>} */
  const sources = new Map();
  const sourceOf = (/** @type {Component} */ c) => {
    if (bundled) return Promise.resolve(source);
    if (!sources.has(c))
      sources.set(c, resolve ? resolve(c.name).catch(() => null) : Promise.resolve(null));
    return /** @type {Promise<Source | null>} */ (sources.get(c));
  };
  const load = (/** @type {Component} */ c) => {
    let form = forms.get(c);
    if (!form) {
      form = (async () => {
        const from = await sourceOf(c);
        if (!from)
          throw new Error(`${c.name} is a separate file that was not opened with this one.`);
        return readForm(from, bundled ? c.offset : (await outerForm(from)).offset);
      })();
      form.catch(() => forms.delete(c));
      forms.set(c, form);
      while (forms.size > KEEP) forms.delete(/** @type {Component} */ (forms.keys().next().value));
    }
    return form;
  };
  /** @type {import("./page.js").Context} */
  const context = {
    include: (id) => {
      const c = components.find((x) => x.id === id);
      if (!c)
        return Promise.reject(new Error(`The page includes ${id}, which the document lacks.`));
      return load(c);
    },
    dictionaries: new Map(),
  };

  const files = components.filter((c) => c.type === PAGE);
  /** @type {Page[]} */
  const pages = [];
  const missing = [];
  for (let i = 0; i < files.length; i += 16) {
    const batch = await Promise.all(
      files.slice(i, i + 16).map((c) => headOf(c, sourceOf, bundled)),
    );
    for (const [k, page] of batch.entries()) {
      pages.push(page);
      if (page.missing) missing.push(files[i + k].name);
    }
  }

  const title = await titleOf(components, files, load);
  const page = (/** @type {number} */ index) => {
    if (!Number.isInteger(index) || index < 0 || index >= files.length) {
      throw new RangeError(`There is no page ${index + 1}: the document has ${files.length}.`);
    }
    if (pages[index].missing) {
      return Promise.reject(
        new Error(
          bundled
            ? `Page ${index + 1} is missing: the file is cut short before it.`
            : `Page ${index + 1} is in ${pages[index].missing}, a separate file not opened here.`,
        ),
      );
    }
    return load(files[index]);
  };
  const pageOf = (/** @type {string} */ target) => {
    if (/^\d+$/.test(target)) {
      const n = Number(target) - 1;
      return n >= 0 && n < files.length ? n : null;
    }
    const at = files.findIndex((c) => c.id === target || c.name === target || c.title === target);
    return at >= 0 ? at : null;
  };

  return {
    title,
    pages,
    note: !missing.length
      ? undefined
      : bundled
        ? `The file is cut short: ${missing.length} of its ${files.length} pages are missing.`
        : `This indirect document keeps ${missing.length} of its ${files.length} pages in separate files ` +
          `that were not opened: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}.`,
    /** @param {number} index @param {{ scale?: number, signal?: AbortSignal }} [options] */
    async renderPage(index, options = {}) {
      return renderForm(await page(index), context, options);
    },
    /** @param {number} index @returns {Promise<string | null>} */
    async pageText(index) {
      const chunks = await pageChunks(await page(index), context);
      const text = chunks.find((c) => c.id === "TXTz" || c.id === "TXTa");
      return text ? readText(text.data, text.id === "TXTz") : null;
    },
    /** @returns {Promise<Outline[]>} */
    async outline() {
      if (!top) return [];
      const navm = chunksIn(top.bytes, 12).find((c) => c.id === "NAVM");
      return navm ? readOutline(dataOf(top.bytes, navm), pageOf) : [];
    },
  };
}

/**
 * A page's size and orientation from the start of its FORM, without reading the whole page.
 * @param {Component} c @param {(c: Component) => Promise<Source | null>} sourceOf @param {boolean} bundled
 * @returns {Promise<Page>}
 */
async function headOf(c, sourceOf, bundled) {
  const from = await sourceOf(c);
  if (!from) return { width: 0, height: 0, dpi: 0, rotation: 0, missing: c.name };
  const offset = bundled ? c.offset : (await outerForm(from)).offset;
  // A bundled file cut short ends before some of its pages.
  if (offset + 12 > from.size) return { width: 0, height: 0, dpi: 0, rotation: 0, missing: c.id };
  const head = await from.read(offset, 64);
  const kind = String.fromCharCode(...head.subarray(8, 12));
  const end = Math.min(head.length, 8 + u32(head, 4));
  let info;
  try {
    info = pageInfo({ kind, bytes: head.subarray(0, end) });
  } catch {
    info = pageInfo(await readForm(from, offset)); // INFO further in than usual
  }
  const quarter = info.rotation === 90 || info.rotation === 270;
  return {
    width: quarter ? info.height : info.width,
    height: quarter ? info.width : info.height,
    dpi: info.dpi,
    rotation: info.rotation,
  };
}

/**
 * The document title from shared annotations, else from the only page's annotations.
 * @param {Component[]} components @param {Component[]} files @param {(c: Component) => Promise<Form>} load
 */
async function titleOf(components, files, load) {
  const candidates = components.filter((c) => c.type === ANNOTATIONS);
  if (files.length === 1) candidates.push(files[0]);
  for (const c of candidates) {
    try {
      const form = await load(c);
      for (const chunk of chunksIn(form.bytes, 12)) {
        if (chunk.id !== "ANTa" && chunk.id !== "ANTz") continue;
        const data = dataOf(form.bytes, chunk);
        const text = new TextDecoder().decode(chunk.id === "ANTz" ? bzz(data) : data);
        const title = annotationTitle(text);
        if (title) return title;
      }
    } catch {
      // A damaged annotation leaves the document untitled.
    }
  }
  return undefined;
}

/**
 * The DIRM directory (8.3.2): whether the document is bundled, and its component files.
 * @param {Uint8Array} d
 */
function directory(d) {
  if (d.length < 3) throw new Error("The document's directory (DIRM) is cut short.");
  const bundled = (d[0] & 0x80) !== 0;
  if ((d[0] & 0x7f) === 0) {
    throw new Error("The document uses the obsolete version 0 directory, which is not supported.");
  }
  const count = u16(d, 1);
  let at = 3;
  const offsets = [];
  if (bundled) {
    if (at + count * 4 > d.length) throw new Error("The document's directory (DIRM) is cut short.");
    for (let i = 0; i < count; i++, at += 4) offsets.push(u32(d, at));
  }
  const rest = bzz(d.subarray(at));
  let r = count * 3;
  if (r + count > rest.length) throw new Error("The document's directory (DIRM) is damaged.");
  const flags = rest.subarray(r, r + count);
  r += count;
  const text = new TextDecoder();
  const zstring = () => {
    const end = rest.indexOf(0, r);
    if (end < 0) throw new Error("The document's directory (DIRM) is damaged.");
    const s = text.decode(rest.subarray(r, end));
    r = end + 1;
    return s;
  };
  /** @type {Component[]} */
  const components = [];
  for (let i = 0; i < count; i++) {
    const id = zstring();
    const name = flags[i] & 0x80 ? zstring() : id;
    const title = flags[i] & 0x40 ? zstring() : id;
    components.push({ id, name, title, type: flags[i] & 0x3f, offset: offsets[i] ?? 0 });
  }
  return { components, bundled };
}
