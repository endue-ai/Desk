// A PresentationML package as a deck: the presentation part, its slides in order (or, for a template
// without slides, its layouts), each slide's layout, master and theme, backgrounds, notes and the
// hidden mark. Parts are read once; images are decoded when the renderer asks for them.
import { imageUrl } from "../bytes.js";
import { imageCache, NO_FILL, plainText } from "../deck.js";
import { attr, bool, find, kid, kids, num, parseXml, path, relAttr } from "../xml.js";
import { backgroundOf } from "./fill.js";
import { readTree } from "./shapes.js";
import { EMPTY_THEME, readTheme } from "./theme.js";

/**
 * @typedef {import("../zip.js").Zip} Zip
 * @typedef {import("../deck.js").Deck} Deck
 * @typedef {import("../deck.js").Slide} Slide
 * @typedef {import("../deck.js").Fill} Fill
 * @typedef {import("./fill.js").PartContext} PartContext
 * @typedef {import("./shapes.js").Scope} Scope
 * @typedef {{ type: string, target: string, external: boolean }} Rel
 * @typedef {{ path: string, root: Element, rels: Map<string, Rel> }} Part
 * @typedef {{ type: string, idx: string | null, el: Element }} Placeholder
 * @typedef {{ part: Part, ctx: PartContext, phs: Placeholder[], styles: Record<string, Element | null> }} Master
 * @typedef {{ part: Part, master: Master, ctx: PartContext, phs: Placeholder[] }} Layout
 */

const EMU = 12700;
const TYPES = /** @type {Record<string, string>} */ ({
  ctrTitle: "title",
  subTitle: "body",
  obj: "body",
});
const normal = (/** @type {string} */ type) =>
  TYPES[type] ?? (["title", "dt", "ftr", "sldNum", "hdr"].includes(type) ? type : "body");

/** A relationship target as a part name: "../media/a.png" from ppt/slides/s.xml is ppt/media/a.png. */
function resolve(/** @type {string} */ from, /** @type {string} */ target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/** @param {Zip} zip */
function parts(zip) {
  /** @type {Map<string, Promise<Part>>} */
  const cache = new Map();
  const relsOf = async (/** @type {string} */ name) => {
    const slash = name.lastIndexOf("/");
    const relsName = `${name.slice(0, slash + 1)}_rels/${name.slice(slash + 1)}.rels`;
    /** @type {Map<string, Rel>} */
    const rels = new Map();
    if (!zip.has(relsName)) return rels;
    for (const rel of kids(parseXml(await zip.text(relsName)), "Relationship")) {
      const external = attr(rel, "TargetMode") === "External";
      const target = attr(rel, "Target") ?? "";
      const type = (attr(rel, "Type") ?? "").split("/").pop() ?? "";
      rels.set(attr(rel, "Id") ?? "", {
        type,
        external,
        target: external ? target : resolve(name, target),
      });
    }
    return rels;
  };
  return (/** @type {string} */ name) => {
    let found = cache.get(name);
    if (!found) {
      found = (async () => ({
        path: name,
        root: parseXml(await zip.text(name)),
        rels: await relsOf(name),
      }))();
      cache.set(name, found);
    }
    return found;
  };
}

const relOfType = (/** @type {Part} */ part, /** @type {string} */ type) =>
  [...part.rels.values()].find((r) => r.type === type && !r.external);

/** The placeholders of a layout's or master's tree. @param {Part} part */
const placeholders = (part) =>
  kids(path(part.root, "cSld", "spTree"))
    .map((el) => {
      const ph = path(kid(el, "nvSpPr", "nvPicPr", "nvGraphicFramePr"), "nvPr", "ph");
      return ph ? { type: attr(ph, "type") ?? "body", idx: attr(ph, "idx"), el } : null;
    })
    .filter((p) => p !== null);

/** The colour map, with a part's override applied. */
function colorMap(/** @type {Element | null} */ base, /** @type {Element | null} */ override) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const el of [base, kid(override, "overrideClrMapping")])
    if (el) for (const a of el.attributes) map[a.localName] = a.value;
  return map;
}

/** A layout or master placeholder matching a slide's: by idx, then by type. */
function match(
  /** @type {Placeholder[]} */ list,
  /** @type {string} */ type,
  /** @type {string | null} */ idx,
) {
  const kind = normal(type);
  if (kind !== "title" && idx !== null) {
    const byIdx = list.filter((p) => p.idx === idx);
    const found = byIdx.find((p) => normal(p.type) === kind) ?? byIdx[0];
    if (found) return found;
  }
  return list.find((p) => p.type === type) ?? list.find((p) => normal(p.type) === kind) ?? null;
}

/** @param {Zip} zip @returns {Promise<Deck>} */
export async function readPptx(zip, format = "PowerPoint presentation") {
  const part = parts(zip);
  const officeDocument = (await relsOfRoot(zip)) ?? "ppt/presentation.xml";
  const pres = await part(officeDocument);
  const size = kid(pres.root, "sldSz");
  const defaults = kid(pres.root, "defaultTextStyle");
  const presentationTheme = relOfType(pres, "theme");
  const tablePart = relOfType(pres, "tableStyles");
  const tableStyles =
    tablePart && zip.has(tablePart.target) ? (await part(tablePart.target)).root : null;

  /** @type {Map<string, Promise<Master>>} */
  const masters = new Map();
  const masterOf = (/** @type {string} */ name) => {
    let found = masters.get(name);
    if (!found) {
      found = (async () => {
        const p = await part(name);
        const themeRel = relOfType(p, "theme") ?? presentationTheme;
        const theme = themeRel ? readTheme((await part(themeRel.target)).root) : EMPTY_THEME;
        const txStyles = kid(p.root, "txStyles");
        return {
          part: p,
          ctx: contextOf(p, theme, colorMap(kid(p.root, "clrMap"), null)),
          phs: placeholders(p),
          styles: {
            title: kid(txStyles, "titleStyle"),
            body: kid(txStyles, "bodyStyle"),
            other: kid(txStyles, "otherStyle"),
          },
        };
      })();
      masters.set(name, found);
    }
    return found;
  };
  /** @type {Map<string, Promise<Layout>>} */
  const layouts = new Map();
  const layoutOf = (/** @type {string} */ name) => {
    let found = layouts.get(name);
    if (!found) {
      found = (async () => {
        const p = await part(name);
        const masterRel = relOfType(p, "slideMaster");
        if (!masterRel) throw new Error(`${name} has no master`);
        const master = await masterOf(masterRel.target);
        const ctx = contextOf(
          p,
          master.ctx.theme,
          colorMap(kid(master.part.root, "clrMap"), kid(p.root, "clrMapOvr")),
        );
        return { part: p, master, ctx, phs: placeholders(p) };
      })();
      layouts.set(name, found);
    }
    return found;
  };

  const slideRels = kids(kid(pres.root, "sldIdLst"), "sldId").map((s) =>
    pres.rels.get(relAttr(s, "id") ?? ""),
  );
  /** @type {Array<{ name: string, kind: "slide" | "layout" }>} */
  const order = slideRels
    .filter((r) => r && !r.external && zip.has(r.target))
    .map((r) => ({ name: r?.target ?? "", kind: "slide" }));
  if (order.length === 0) {
    // A template with no slides shows its layouts.
    for (const m of kids(kid(pres.root, "sldMasterIdLst"), "sldMasterId")) {
      const rel = pres.rels.get(relAttr(m, "id") ?? "");
      if (!rel) continue;
      const master = await masterOf(rel.target);
      for (const l of kids(kid(master.part.root, "sldLayoutIdLst"), "sldLayoutId")) {
        const lr = master.part.rels.get(relAttr(l, "id") ?? "");
        if (lr && zip.has(lr.target)) order.push({ name: lr.target, kind: "layout" });
      }
    }
  }

  const images = imageCache(async (id) => imageUrl(await zip.bytes(id)));
  /** @type {Slide[]} */
  const slides = [];
  for (const [i, entry] of order.entries()) {
    try {
      slides.push(await readSlide(entry, i + 1));
    } catch {
      slides.push({
        number: i + 1,
        title: "",
        hidden: false,
        background: NO_FILL,
        notes: "",
        elements: [],
      });
    }
  }
  return {
    format,
    size: { width: num(size, "cx", 9144000) / EMU, height: num(size, "cy", 6858000) / EMU },
    slides,
    textOnly: false,
    image: images,
  };

  /** One slide (or layout, for templates). @param {{ name: string, kind: string }} entry @param {number} number */
  async function readSlide(entry, number) {
    const p = await part(entry.name);
    const isLayout = entry.kind === "layout";
    const layout = isLayout
      ? await layoutOf(entry.name)
      : await layoutOf(relOfType(p, "slideLayout")?.target ?? "");
    const master = layout.master;
    const ctx = isLayout
      ? layout.ctx
      : contextOf(
          p,
          master.ctx.theme,
          colorMap(kid(master.part.root, "clrMap"), kid(p.root, "clrMapOvr")),
        );
    const inherit = (/** @type {string} */ type, /** @type {string | null} */ idx) => {
      const fromLayout = isLayout ? null : match(layout.phs, type, idx);
      const fromMaster = match(master.phs, fromLayout?.type ?? type, null);
      return [
        fromMaster && { el: fromMaster.el, ctx: master.ctx },
        fromLayout && { el: fromLayout.el, ctx: layout.ctx },
      ].filter((x) => x !== null);
    };
    /** @type {(c: PartContext) => Scope} */
    const scopeOf = (c) => ({
      ctx: c,
      inherit,
      lists: (type) => {
        const kind = type ? normal(type) : "";
        const style =
          kind === "title"
            ? master.styles.title
            : kind === "body"
              ? master.styles.body
              : master.styles.other;
        return kind === "title" || kind === "body"
          ? [style].filter((s) => s !== null)
          : [defaults, style].filter((s) => s !== null);
      },
      table: (id) =>
        id
          ? ([...(tableStyles?.getElementsByTagNameNS("*", "tblStyle") ?? [])].find(
              (s) => attr(s, "styleId") === id,
            ) ?? null)
          : null,
      drawing: (frame) => drawingOf(frame, p),
      slideNumber: number,
    });
    const notPlaceholder = (/** @type {Element} */ el) =>
      !path(
        kid(el, "nvSpPr", "nvPicPr", "nvGrpSpPr", "nvGraphicFramePr", "nvCxnSpPr"),
        "nvPr",
        "ph",
      );
    const showMaster = (/** @type {Element} */ root) => attr(root, "showMasterSp") !== "0";
    const elements = [];
    if (showMaster(p.root) && showMaster(layout.part.root))
      elements.push(
        ...(await readTree(
          path(master.part.root, "cSld", "spTree") ?? p.root,
          scopeOf(master.ctx),
          notPlaceholder,
        )),
      );
    if (!isLayout && showMaster(p.root))
      elements.push(
        ...(await readTree(
          path(layout.part.root, "cSld", "spTree") ?? p.root,
          scopeOf(layout.ctx),
          notPlaceholder,
        )),
      );
    elements.push(...(await readTree(path(p.root, "cSld", "spTree") ?? p.root, scopeOf(ctx))));
    const background = backgroundOf(path(p.root, "cSld", "bg"), ctx) ??
      backgroundOf(path(layout.part.root, "cSld", "bg"), layout.ctx) ??
      backgroundOf(path(master.part.root, "cSld", "bg"), master.ctx) ?? {
        type: "solid",
        color: "#ffffff",
      };
    const heading = elements.find(
      (e) => e.type === "shape" && (e.placeholder === "title" || e.placeholder === "ctrTitle"),
    );
    const name = isLayout ? attr(path(p.root, "cSld"), "name") : null;
    return {
      number,
      title:
        heading?.type === "shape"
          ? plainText(heading.text).replace(/\s+/g, " ").trim()
          : (name ?? ""),
      hidden: !bool(p.root, "show", true),
      background,
      elements,
      notes: isLayout ? "" : await notesOf(p),
    };
  }

  /** The text of a slide's notes: its notes page's body placeholder. @param {Part} slide */
  async function notesOf(slide) {
    const rel = relOfType(slide, "notesSlide");
    if (!rel || !zip.has(rel.target)) return "";
    const notes = await part(rel.target);
    const body = kids(path(notes.root, "cSld", "spTree"), "sp").find((sp) => {
      const ph = path(sp, "nvSpPr", "nvPr", "ph");
      return ph && (attr(ph, "type") ?? "body") === "body";
    });
    return kids(kid(body, "txBody"), "p")
      .map((p) =>
        kids(p, "r", "br", "fld")
          .map((r) => (r.localName === "br" ? "\n" : (kid(r, "t")?.textContent ?? "")))
          .join(""),
      )
      .join("\n")
      .trim();
  }

  /** A SmartArt frame's cached drawing: the data part names it with dsp:dataModelExt. */
  async function drawingOf(/** @type {Element} */ frame, /** @type {Part} */ slide) {
    const ids = find(frame, "relIds");
    const data = slide.rels.get(relAttr(ids, "dm") ?? "");
    if (!data || !zip.has(data.target)) return null;
    const ext = find((await part(data.target)).root, "dataModelExt");
    const drawing = slide.rels.get(attr(ext, "relId") ?? "") ?? relOfType(slide, "diagramDrawing");
    if (!drawing || !zip.has(drawing.target)) return null;
    return find((await part(drawing.target)).root, "spTree");
  }

  /** @param {Part} p @param {import("./theme.js").Theme} theme @param {Record<string, string>} map @returns {PartContext} */
  function contextOf(p, theme, map) {
    return {
      theme,
      scheme: theme.scheme,
      map,
      image: (rId) => {
        const rel = rId ? p.rels.get(rId) : undefined;
        return rel && !rel.external && zip.has(rel.target) ? rel.target : null;
      },
    };
  }
}

/** The main part named in _rels/.rels. @param {Zip} zip */
async function relsOfRoot(zip) {
  if (!zip.has("_rels/.rels")) return null;
  const root = parseXml(await zip.text("_rels/.rels"));
  const rel = kids(root, "Relationship").find((r) =>
    (attr(r, "Type") ?? "").endsWith("/officeDocument"),
  );
  return rel ? resolve("", attr(rel, "Target") ?? "") : null;
}
