// Find in the document's text: matches inside each paragraph (across its runs), marked with
// <mark> elements, one of them current. Clearing puts the text nodes back as they were.

const BLOCKS = "p, td, li, .note-text";

/**
 * @param {HTMLElement} root the pages
 */
export function createFind(root) {
  /** @type {HTMLElement[][]} */
  let hits = [];
  let current = -1;

  const clear = () => {
    for (const mark of Array.from(root.querySelectorAll("mark.find-hit"))) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parent.replaceChild(root.ownerDocument.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
    hits = [];
    current = -1;
  };

  /** Mark every match of `query` (case-insensitive); returns how many. */
  const search = (/** @type {string} */ query) => {
    clear();
    const needle = query.toLowerCase();
    if (!needle) return 0;
    const doc = root.ownerDocument;
    /** @type {Map<Element, Text[]>} */
    const groups = new Map();
    const walker = doc.createTreeWalker(root, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = /** @type {Text} */ (node);
      const block = text.parentElement?.closest(BLOCKS);
      if (!block || !text.nodeValue) continue;
      const list = groups.get(block) ?? [];
      list.push(text);
      groups.set(block, list);
    }
    /** @type {Array<{ node: Text, start: number, end: number, hit: number }>} */
    const pieces = [];
    for (const nodes of groups.values()) {
      const joined = nodes
        .map((n) => n.nodeValue ?? "")
        .join("")
        .toLowerCase();
      for (
        let at = joined.indexOf(needle);
        at >= 0;
        at = joined.indexOf(needle, at + needle.length)
      ) {
        const hit = hits.length;
        hits.push([]);
        let offset = 0;
        for (const node of nodes) {
          const length = node.nodeValue?.length ?? 0;
          const start = Math.max(at, offset);
          const end = Math.min(at + needle.length, offset + length);
          if (start < end) pieces.push({ node, start: start - offset, end: end - offset, hit });
          offset += length;
        }
      }
    }
    // Wrap from the last piece of each node to the first, so earlier offsets stay right.
    for (const piece of pieces.reverse()) {
      const { node, start, end, hit } = piece;
      const tail = node.splitText(start);
      tail.splitText(end - start);
      const mark = doc.createElement("mark");
      mark.className = "find-hit";
      tail.parentNode?.replaceChild(mark, tail);
      mark.append(tail);
      hits[hit]?.unshift(mark);
    }
    return hits.length;
  };

  /** Make the hit at `index` (wrapping) current and scroll to it; returns its index. */
  const go = (/** @type {number} */ index) => {
    if (hits.length === 0) return -1;
    for (const mark of hits[current] ?? []) mark.classList.remove("is-current");
    current = ((index % hits.length) + hits.length) % hits.length;
    const marks = hits[current] ?? [];
    for (const mark of marks) mark.classList.add("is-current");
    marks[0]?.scrollIntoView?.({ block: "center" });
    return current;
  };

  return {
    search,
    clear,
    next: () => go(current + 1),
    previous: () => go(current - 1),
    first: () => go(0),
    get count() {
      return hits.length;
    },
    get current() {
      return current;
    },
  };
}
