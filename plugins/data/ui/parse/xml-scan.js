// A forgiving reader of XML's markup: start and end tags with their attributes, text and CDATA, in
// document order with their offsets; comments, processing instructions and the DOCTYPE (with its
// internal subset) are skipped. xml.js takes the structure and values from DOMParser and the
// positions from here, and after a parse error builds the tree from here up to the error.

/**
 * @typedef {{ name: string, at: number, from: number, to: number, value: string }} ScannedAttr
 * @typedef {{ cdata: boolean, from: number, to: number, value: string }} ScannedText
 * @typedef {{ name: string, at: number, end: number, attrs: ScannedAttr[], texts: ScannedText[],
 *   kids: ScannedElement[], parent?: ScannedElement }} ScannedElement
 */

const NAME = /[^\s/>=]+/y;
const ATTR = /\s*([^\s/>=]+)\s*=\s*("[^"]*"|'[^']*')/y;
/** @type {Record<string, string>} */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decode the predefined entities and character references; others stay as written. */
export const decodeEntities = (/** @type {string} */ text) =>
  text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);/g, (whole, ref) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(Number(ref.slice(1)));
    return ENTITIES[ref] ?? whole;
  });

/**
 * Every element up to `until`, in document order, and the first problem the reader saw itself.
 * @param {string} text
 * @param {number} [until]
 */
export function scanXml(text, until = text.length) {
  /** @type {ScannedElement[]} */
  const elements = [];
  /** @type {ScannedElement[]} */
  const roots = [];
  /** @type {ScannedElement | undefined} */
  let open;
  /** @type {{ offset: number, message: string } | undefined} */
  let problem;
  let pos = 0;
  const textUntil = (/** @type {number} */ end) => {
    const raw = text.slice(pos, end);
    const first = raw.search(/\S/);
    if (open && first >= 0) {
      const last = raw.length - (raw.length - raw.trimEnd().length);
      open.texts.push({
        cdata: false,
        from: pos + first,
        to: pos + last,
        value: decodeEntities(raw),
      });
    }
    pos = end;
  };
  while (pos < until) {
    const lt = text.indexOf("<", pos);
    if (lt < 0 || lt >= until) {
      textUntil(until);
      break;
    }
    textUntil(lt);
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      pos = end < 0 ? until : end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      const stop = end < 0 ? until : end;
      open?.texts.push({ cdata: true, from: lt + 9, to: stop, value: text.slice(lt + 9, stop) });
      pos = end < 0 ? until : end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      pos = end < 0 ? until : end + 2;
    } else if (text.startsWith("<!", lt)) {
      pos = skipDeclaration(text, lt);
    } else if (text[lt + 1] === "/") {
      const gt = text.indexOf(">", lt);
      const name = text.slice(lt + 2, gt < 0 ? until : gt).trim();
      if (!open || open.name !== name) {
        problem ??= {
          offset: lt,
          message: open
            ? `</${name}> does not close <${open.name}>.`
            : `</${name}> closes nothing.`,
        };
      } else {
        open.end = gt + 1;
        open = open.parent;
      }
      pos = gt < 0 ? until : gt + 1;
    } else {
      NAME.lastIndex = lt + 1;
      const name = NAME.exec(text)?.[0] ?? "";
      /** @type {ScannedElement} */
      const element = { name, at: lt, end: until, attrs: [], texts: [], kids: [], parent: open };
      let at = lt + 1 + name.length;
      for (;;) {
        ATTR.lastIndex = at;
        const m = ATTR.exec(text);
        if (!m || m.index !== at) break;
        const quoted = m[2] ?? "";
        const valueAt = ATTR.lastIndex - quoted.length;
        const nameAt = text.indexOf(m[1] ?? "", at);
        element.attrs.push({
          name: m[1] ?? "",
          at: nameAt,
          from: valueAt + 1,
          to: ATTR.lastIndex - 1,
          value: decodeEntities(quoted.slice(1, -1)),
        });
        at = ATTR.lastIndex;
      }
      const gt = text.indexOf(">", at);
      if (gt < 0) problem ??= { offset: lt, message: `<${name}> is not closed.` };
      elements.push(element);
      if (open) open.kids.push(element);
      else roots.push(element);
      const selfClosing = gt > 0 && text[gt - 1] === "/";
      if (selfClosing) element.end = gt + 1;
      else open = element;
      pos = gt < 0 ? until : gt + 1;
    }
  }
  if (open && !problem) problem = { offset: until, message: `<${open.name}> is not closed.` };
  return { elements, roots, problem };
}

/** Skip `<!DOCTYPE ...>` and other declarations, with an internal subset in brackets. */
function skipDeclaration(/** @type {string} */ text, /** @type {number} */ lt) {
  let depth = 0;
  for (let at = lt + 2; at < text.length; at++) {
    const c = text[at];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === '"' || c === "'") {
      const close = text.indexOf(c, at + 1);
      if (close < 0) return text.length;
      at = close;
    } else if (c === ">" && depth <= 0) return at + 1;
  }
  return text.length;
}
