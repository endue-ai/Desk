// The markup subtitle formats: TTML and DFXP (XML, read with the frame's DOMParser: begin, end and
// dur in every time expression TTML allows, nested spans, line breaks) and SAMI (HTML-like SYNC
// blocks, one cue list per language class named in its STYLE block).

/**
 * @typedef {import("./subtitles.js").Cue} Cue
 * @typedef {import("./subtitles.js").Language} Language
 */

const round = (/** @type {number} */ seconds) => Math.round(seconds * 1000) / 1000;

/**
 * A TTML time expression in seconds: clock time (hh:mm:ss.fff or hh:mm:ss:ff) or an offset
 * (1.5s, 100ms, 2m, 1h, 30f, 100t).
 * @param {string | null} value
 * @param {{ frameRate: number, tickRate: number }} rates
 */
function ttmlTime(value, rates) {
  if (!value) return null;
  const text = value.trim();
  const clock = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+)|:(\d+(?:\.\d+)?))?$/.exec(text);
  if (clock) {
    const [, h = "0", m = "0", s = "0", fraction, frames] = clock;
    const base = Number(h) * 3600 + Number(m) * 60 + Number(s);
    if (frames !== undefined) return base + Number(frames) / rates.frameRate;
    return base + (fraction ? Number(`0.${fraction}`) : 0);
  }
  const offset = /^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/.exec(text);
  if (!offset) return null;
  const n = Number(offset[1]);
  const unit = offset[2];
  if (unit === "h") return n * 3600;
  if (unit === "m") return n * 60;
  if (unit === "ms") return n / 1000;
  if (unit === "f") return n / rates.frameRate;
  if (unit === "t") return n / rates.tickRate;
  return n;
}

/** A paragraph's words: text with whitespace collapsed, br as a line break, spans flattened. */
function words(/** @type {Node} */ node) {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += (child.textContent ?? "").replace(/\s+/g, " ");
    else if (child.nodeType === 1)
      out += /** @type {Element} */ (child).localName === "br" ? "\n" : words(child);
  }
  return out;
}

/** @param {string} text */
export function parseTtml(text) {
  if (typeof DOMParser === "undefined") throw new Error("TTML needs the frame's XML parser.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new Error("The TTML file is not well-formed XML.");
  const root = doc.documentElement;
  const attr = (/** @type {Element} */ e, /** @type {string} */ name) =>
    e.getAttribute(name) ??
    e.getAttributeNS("http://www.w3.org/ns/ttml#parameter", name.replace(/^ttp:/, ""));
  const frameRate = Number(attr(root, "ttp:frameRate")) || 30;
  const tickRate = Number(attr(root, "ttp:tickRate")) || frameRate;
  const rates = { frameRate, tickRate };
  /** @type {Cue[]} */
  const cues = [];
  for (const p of root.getElementsByTagNameNS("*", "p")) {
    let offset = 0;
    for (let e = p.parentElement; e && e !== root; e = e.parentElement)
      offset += ttmlTime(e.getAttribute("begin"), rates) ?? 0;
    const begin = ttmlTime(p.getAttribute("begin"), rates);
    const end = ttmlTime(p.getAttribute("end"), rates);
    const dur = ttmlTime(p.getAttribute("dur"), rates);
    if (begin === null || (end === null && dur === null)) continue;
    const start = offset + begin;
    const stop = end !== null ? offset + end : start + (dur ?? 0);
    const lines = words(p)
      .split("\n")
      .map((line) => line.trim());
    cues.push({ start: round(start), end: round(stop), text: lines.join("\n").trim() });
  }
  return cues;
}

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
});

/** A SAMI paragraph's words. */
function samiWords(/** @type {string} */ html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|[a-z]+);?/gi, (whole, name) =>
      String(name).startsWith("#")
        ? String.fromCodePoint(Number(String(name).slice(1)))
        : (ENTITIES[String(name).toLowerCase()] ?? whole),
    )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

/**
 * SAMI: the cues of one language class (the first the STYLE block names unless `language` says),
 * and every class with its name and language.
 * @param {string} text
 * @param {string} [language]
 * @returns {{ cues: Cue[], languages: Language[] }}
 */
export function parseSami(text, language) {
  /** @type {Language[]} */
  const named = [];
  const style = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(text)?.[1] ?? "";
  for (const m of style.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const body = m[2] ?? "";
    named.push({
      id: m[1] ?? "",
      name: /name\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim() ?? m[1] ?? "",
      lang: /lang\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim() ?? "",
    });
  }
  /** Per class: the start of each SYNC and its words ("" ends the previous cue). */
  /** @type {Map<string, Array<{ at: number, words: string }>>} */
  const timelines = new Map();
  const body = text.slice(Math.max(0, text.search(/<body/i)));
  const syncs = body.split(/<sync\b/i).slice(1);
  for (const sync of syncs) {
    const at = Number(/start\s*=\s*"?(\d+)/i.exec(sync)?.[1] ?? Number.NaN);
    if (!Number.isFinite(at)) continue;
    const content = sync.slice(sync.indexOf(">") + 1).replace(/<\/(sync|body|sami)>[\s\S]*$/i, "");
    const paragraphs = content.split(/<p\b/i);
    const leading = paragraphs.shift() ?? "";
    if (paragraphs.length === 0) paragraphs.push(`>${leading}`);
    for (const p of paragraphs) {
      const id = /class\s*=\s*"?([\w-]+)/i.exec(p.slice(0, p.indexOf(">") + 1))?.[1] ?? "";
      const line = { at: at / 1000, words: samiWords(p.slice(p.indexOf(">") + 1)) };
      const timeline = timelines.get(id) ?? [];
      timeline.push(line);
      timelines.set(id, timeline);
    }
  }
  const order = [
    ...named.map((n) => n.id).filter((id) => timelines.has(id)),
    ...[...timelines.keys()].filter((id) => !named.some((n) => n.id === id)),
  ];
  const languages = order.map(
    (id) => named.find((n) => n.id === id) ?? { id, name: id || "Default", lang: "" },
  );
  const pick = language && timelines.has(language) ? language : order[0];
  const timeline = (pick === undefined ? [] : (timelines.get(pick) ?? [])).sort(
    (a, b) => a.at - b.at,
  );
  /** @type {Cue[]} */
  const cues = [];
  timeline.forEach((line, i) => {
    if (!line.words) return;
    const next = timeline.slice(i + 1).find((l) => l.at > line.at);
    cues.push({
      start: round(line.at),
      end: round(next ? next.at : line.at + 5),
      text: line.words,
    });
  });
  return { cues, languages };
}
