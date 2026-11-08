// The source view: the file's text with line numbers and tag colours. Rows are drawn only where
// the view is scrolled to, so a large file opens at once; a long line wraps into rows of 1000
// characters. Colouring follows tags, attributes, values and comments across rows.

const ROW_CHARS = 1000;
/** Must match `.source-row` in style.css. */
const ROW_HEIGHT = 20;
const OVERSCAN = 30;
/** Past this size the text is drawn without colours. */
const COLOUR_LIMIT = 4 * 1024 * 1024;

const TEXT = 0;
const TAG = 1;
const DQ = 2;
const SQ = 3;
const COMMENT = 4;
const RAW = 5;
/** The state is the mode in the low bits and the raw-text element (1 script, 2 style) above. */
const pack = (/** @type {number} */ mode, /** @type {number} */ raw) => mode | (raw << 3);

/**
 * Colour text[a, b) from `state`, calling emit(kind, from, to) per piece; returns the state after.
 * @param {string} text @param {string} lower @param {number} a @param {number} b @param {number} state
 * @param {(kind: string, from: number, to: number) => void} emit
 */
export function colour(text, lower, a, b, state, emit) {
  let mode = state & 7;
  let raw = state >> 3;
  let i = a;
  while (i < b) {
    if (mode === TEXT) {
      const next = text.indexOf("<", i);
      const end = next < 0 || next >= b ? b : next;
      if (end > i) emit("text", i, end);
      i = end;
      if (i >= b) break;
      if (text.startsWith("<!--", i)) mode = COMMENT;
      else if (/[A-Za-z/!?]/.test(text[i + 1] ?? "")) {
        let j = i + 1;
        if (text[j] === "/") j++;
        while (j < b && /[^\s>/]/.test(text[j] ?? "")) j++;
        const name = lower.slice(i + 1, j);
        emit("tag", i, j);
        raw = name === "script" ? 1 : name === "style" ? 2 : 0;
        mode = TAG;
        i = j;
      } else {
        emit("text", i, i + 1);
        i++;
      }
    } else if (mode === COMMENT) {
      const end = text.indexOf("-->", i);
      const stop = end < 0 || end + 3 > b ? b : end + 3;
      emit("comment", i, stop);
      if (stop === end + 3) mode = TEXT;
      i = stop;
    } else if (mode === RAW) {
      const end = lower.indexOf(raw === 1 ? "</script" : "</style", i);
      const stop = end < 0 || end >= b ? b : end;
      if (stop > i) emit("text", i, stop);
      if (stop === end) mode = TEXT;
      raw = mode === TEXT ? 0 : raw;
      i = stop;
    } else if (mode === DQ || mode === SQ) {
      const end = text.indexOf(mode === DQ ? '"' : "'", i);
      const stop = end < 0 || end >= b ? b : end + 1;
      emit("value", i, stop);
      if (stop === end + 1) mode = TAG;
      i = stop;
    } else {
      const c = text[i] ?? "";
      if (c === ">") {
        emit("tag", i, i + 1);
        i++;
        mode = raw ? RAW : TEXT;
      } else if (c === "/" && text[i + 1] === ">") {
        emit("tag", i, i + 2);
        i += 2;
        mode = TEXT;
        raw = 0;
      } else if (c === '"' || c === "'") {
        mode = c === '"' ? DQ : SQ;
        const end = text.indexOf(c, i + 1);
        const stop = end < 0 || end >= b ? b : end + 1;
        emit("value", i, stop);
        if (stop === end + 1) mode = TAG;
        i = stop;
      } else if (c === "=" || /\s/.test(c)) {
        let j = i + 1;
        while (j < b && /\s/.test(text[j] ?? "")) j++;
        emit("text", i, j);
        i = j;
        if (c === "=" && i < b && !/["'>]/.test(text[i] ?? "")) {
          let k = i;
          while (k < b && !/[\s>]/.test(text[k] ?? "")) k++;
          emit("value", i, k);
          i = k;
        }
      } else {
        let j = i;
        while (j < b && /[^\s=>/"']/.test(text[j] ?? "")) j++;
        if (j === i) j++;
        emit("attr", i, j);
        i = j;
      }
    }
  }
  return pack(mode, raw);
}

/**
 * @param {Document} doc
 * @param {HTMLElement} container the scrolling element
 */
export function createSource(doc, container) {
  const spacer = doc.createElement("div");
  spacer.className = "source-spacer";
  const rows = doc.createElement("div");
  rows.className = "source-rows";
  spacer.append(rows);
  container.replaceChildren(spacer);
  let text = "";
  let lower = "";
  let coloured = true;
  /** Per row: where it starts and ends, its line number (0 on a wrapped row), its start state. */
  let starts = new Uint32Array(0);
  let ends = new Uint32Array(0);
  let numbers = new Uint32Array(0);
  let states = new Uint8Array(0);
  let drawn = "";

  const layout = () => {
    /** @type {number[]} */
    const s = [];
    /** @type {number[]} */
    const e = [];
    /** @type {number[]} */
    const n = [];
    let line = 1;
    for (let at = 0; at <= text.length; line++) {
      let end = text.indexOf("\n", at);
      if (end < 0) end = text.length;
      const stop = end > at && text[end - 1] === "\r" ? end - 1 : end;
      for (let from = at; from === at || from < stop; from += ROW_CHARS) {
        s.push(from);
        e.push(Math.min(stop, from + ROW_CHARS));
        n.push(from === at ? line : 0);
      }
      at = end + 1;
      if (end === text.length) break;
    }
    starts = Uint32Array.from(s);
    ends = Uint32Array.from(e);
    numbers = Uint32Array.from(n);
    states = new Uint8Array(starts.length);
    if (!coloured) return;
    let state = TEXT;
    const none = () => {};
    for (let row = 0; row < starts.length; row++) {
      states[row] = state;
      const next = row + 1 < starts.length ? (starts[row + 1] ?? text.length) : text.length;
      state = colour(text, lower, starts[row] ?? 0, next, state, none);
    }
  };

  const draw = () => {
    const height = container.clientHeight || 800;
    const first = Math.max(0, Math.floor(container.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      starts.length,
      Math.ceil((container.scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
    );
    const key = `${first}:${last}`;
    if (key === drawn) return;
    drawn = key;
    rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    const fragment = doc.createDocumentFragment();
    for (let row = first; row < last; row++) {
      const line = doc.createElement("div");
      line.className = "source-row";
      const number = doc.createElement("span");
      number.className = "line-number";
      number.setAttribute("aria-hidden", "true");
      number.textContent = numbers[row] ? String(numbers[row]) : "";
      const code = doc.createElement("span");
      code.className = "code";
      const a = starts[row] ?? 0;
      const b = ends[row] ?? a;
      if (coloured)
        colour(text, lower, a, b, states[row] ?? 0, (kind, from, to) => {
          if (kind === "text") code.append(text.slice(from, to));
          else {
            const piece = doc.createElement("span");
            piece.className = kind;
            piece.textContent = text.slice(from, to);
            code.append(piece);
          }
        });
      else code.textContent = text.slice(a, b);
      line.append(number, code);
      fragment.append(line);
    }
    rows.replaceChildren(fragment);
  };

  container.addEventListener("scroll", draw, { passive: true });

  return {
    /** Show this text from its first line. */
    show(/** @type {string} */ value) {
      text = value;
      coloured = value.length <= COLOUR_LIMIT;
      // ASCII only, so every index in `lower` is the same character's index in `text`.
      lower = coloured ? value.replace(/[A-Z]+/g, (upper) => upper.toLowerCase()) : "";
      layout();
      spacer.style.height = `${starts.length * ROW_HEIGHT}px`;
      container.scrollTop = 0;
      drawn = "";
      draw();
    },
    /** Draw the rows in view again, after the view was shown or resized. */
    refresh() {
      drawn = "";
      draw();
    },
  };
}
