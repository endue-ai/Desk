// Search in the document's text: Mod+F opens the bar, Enter and Mod+G go to the next match,
// Shift+Enter and Shift+Mod+G to the one before, across pages or chapters and around the end.
// A unit's text (book.text) says whether it has the words; on screen the matches are marked
// (<mark>, or <tspan> inside SVG text) and the current one is scrolled to.

/**
 * @typedef {{ text(i: number): Promise<string> }} Searchable
 * @typedef {{ book(): (Searchable & { kind: string, format: string }) | null, count(): number, current(): number,
 *   show(unit: number): Promise<ParentNode | null>, unitName(unit: number): string, status(text: string): void }} FindHooks
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const fold = (/** @type {string} */ s) => s.toLocaleLowerCase().replace(/\s+/g, " ");

/** Unwrap the marks a search left. */
function unmark(/** @type {ParentNode | null} */ root) {
  if (!root) return;
  for (const mark of root.querySelectorAll("mark.hit, tspan.hit")) {
    mark.replaceWith(...mark.childNodes);
  }
  for (const node of root.querySelectorAll("*")) node.normalize?.();
}

/** Mark every occurrence of `query` in the text under `root`; returns the marks in order. */
function markAll(/** @type {ParentNode} */ root, /** @type {string} */ query) {
  const doc =
    /** @type {Node} */ (/** @type {unknown} */ (root)).ownerDocument ??
    /** @type {Document} */ (/** @type {unknown} */ (root));
  const walker = doc.createTreeWalker(/** @type {Node} */ (/** @type {unknown} */ (root)), 4);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && !["STYLE", "SCRIPT", "style", "script"].includes(parent.tagName))
      nodes.push(/** @type {Text} */ (node));
  }
  const marks = [];
  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const lower = text.toLocaleLowerCase();
    let at = lower.indexOf(query);
    if (at < 0) continue;
    const svg = node.parentElement?.namespaceURI === SVG_NS;
    const parts = [];
    let from = 0;
    while (at >= 0) {
      if (at > from) parts.push(doc.createTextNode(text.slice(from, at)));
      const mark = svg ? doc.createElementNS(SVG_NS, "tspan") : doc.createElement("mark");
      mark.setAttribute("class", "hit");
      mark.textContent = text.slice(at, at + query.length);
      parts.push(mark);
      marks.push(mark);
      from = at + query.length;
      at = lower.indexOf(query, from);
    }
    if (from < text.length) parts.push(doc.createTextNode(text.slice(from)));
    node.replaceWith(...parts);
  }
  return marks;
}

/**
 * @param {Document} doc
 * @param {FindHooks} hooks
 */
export function createFind(doc, hooks) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const bar = /** @type {HTMLFormElement} */ (byId("find"));
  const input = /** @type {HTMLInputElement} */ (byId("find-text"));
  const said = byId("find-status");
  /** @type {{ query: string, unit: number, index: number, marks: Element[], root: ParentNode | null }} */
  let state = { query: "", unit: -1, index: -1, marks: [], root: null };
  let run = 0;

  const say = (/** @type {string} */ text) => {
    said.textContent = text;
    hooks.status(text);
  };
  const select = (/** @type {number} */ index) => {
    for (const mark of state.marks) mark.classList.remove("current");
    const mark = state.marks[index];
    state.index = index;
    if (!mark) return;
    mark.classList.add("current");
    /** @type {any} */ (mark).scrollIntoView?.({ block: "center" });
    say(`${hooks.unitName(state.unit)}: match ${index + 1} of ${state.marks.length}`);
  };

  /** Move to the next (1) or previous (-1) match. */
  const step = async (/** @type {1 | -1} */ direction) => {
    const query = fold(input.value.trim());
    const book = hooks.book();
    if (!book || !query) return;
    const mine = ++run;
    const fresh = query !== state.query;
    if (!fresh && state.marks[0]?.isConnected) {
      const next = state.index + direction;
      if (next >= 0 && next < state.marks.length) return select(next);
    }
    const count = hooks.count();
    const start = fresh ? hooks.current() : state.unit;
    unmark(state.root);
    state = { query, unit: -1, index: -1, marks: [], root: null };
    for (let n = fresh ? 0 : 1; n <= count; n++) {
      const unit = (((start + direction * n) % count) + count) % count;
      if (n > 0 && n % 20 === 0)
        say(`Searching ${hooks.unitName(unit).toLowerCase()} of ${count}…`);
      const text = fold(await book.text(unit).catch(() => ""));
      if (mine !== run) return;
      if (!text.includes(query)) continue;
      const root = await hooks.show(unit);
      if (mine !== run) return;
      const marks = root ? markAll(root, query) : [];
      state = { query, unit, index: -1, marks, root };
      if (marks.length === 0) return say(`${hooks.unitName(unit)} has “${input.value.trim()}”.`);
      return select(direction === 1 ? 0 : marks.length - 1);
    }
    const empty = book.kind === "pages" && /comic/i.test(book.format);
    say(empty ? "This comic has no text to search." : `No match for “${input.value.trim()}”.`);
  };

  bar.addEventListener("submit", (event) => {
    event.preventDefault();
    void step(1);
  });
  byId("find-prev").addEventListener("click", () => void step(-1));
  byId("find-close").addEventListener("click", () => close());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      void step(-1);
    }
  });
  input.addEventListener("input", () => {
    if (fold(input.value.trim()) !== state.query) said.textContent = "";
  });

  const close = () => {
    run++;
    bar.hidden = true;
    unmark(state.root);
    state = { query: "", unit: -1, index: -1, marks: [], root: null };
    said.textContent = "";
    byId("doc").focus();
  };

  return {
    open() {
      bar.hidden = false;
      input.focus();
      input.select();
    },
    close,
    isOpen: () => !bar.hidden,
    next: () => step(1),
    previous: () => step(-1),
    /** A new document: forget the old matches. */
    reset() {
      run++;
      state = { query: "", unit: -1, index: -1, marks: [], root: null };
      said.textContent = "";
    },
  };
}
