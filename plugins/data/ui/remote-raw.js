// Raw lines arrive already masked and clipped; stale replies cannot repopulate a hidden value.
import { tokenize } from "./raw.js";
import { createVirtual } from "./virtual.js";

export function createRemoteRaw(doc, el, status) {
  let source = null;
  let format = "text";
  let count = 0;
  let version = 0;
  let current = { line: 0, col: 1 };
  const draw = (item) => {
    const row = doc.createElement("div");
    row.className = "line";
    row.dataset.line = String(item.line);
    const number = doc.createElement("span");
    number.className = "ln";
    number.textContent = String(item.line);
    number.setAttribute("aria-hidden", "true");
    const code = doc.createElement("span");
    code.className = "code";
    for (const [kind, text] of tokenize(format, item.text)) {
      if (!kind) code.append(text);
      else {
        const token = doc.createElement("span");
        token.className = kind;
        token.textContent = text;
        code.append(token);
      }
    }
    row.append(number, code);
    if (item.error) {
      row.classList.add("error");
      row.title = item.error;
    }
    if (item.line === current.line) {
      row.classList.add("current");
      row.setAttribute("aria-current", "true");
    }
    return row;
  };
  const virtual = createVirtual(el, 18, (first, last) => {
    const request = ++version;
    if (!source) {
      virtual.window.replaceChildren();
      return;
    }
    void source
      .request("lines", { from: first + 1, count: last - first, current })
      .then((result) => {
        if (request === version) virtual.window.replaceChildren(...result.lines.map(draw));
      })
      .catch((error) => {
        if (request === version && error.name !== "AbortError") status(error.message);
      });
  });
  return {
    load(opened) {
      source = opened?.remote ?? null;
      format = opened?.format ?? "text";
      count = opened?.lineCount ?? 0;
      current = { line: 0, col: 1 };
      el.scrollTop = 0;
      virtual.setCount(count);
      virtual.window.replaceChildren();
      virtual.render();
    },
    mask() {
      virtual.window.replaceChildren();
      virtual.render();
    },
    goTo(line, col = 1) {
      current = { line: Math.max(1, Math.min(count, line)), col };
      virtual.reveal(current.line - 1);
      virtual.render();
    },
    focus() {
      el.focus();
    },
  };
}
