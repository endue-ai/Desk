// The logs pane: one element per line, appended as lines arrive and dropped as they leave the ring,
// drawn whole again only when the target, filter or timestamps change. While following, the pane
// stays at the bottom unless the person scrolled up to read.

import { matches } from "./logs.js";

/** @typedef {import("./docker.js").LogsView} LogsView */

/**
 * @param {Document} doc
 * @param {{ head: HTMLElement, lines: HTMLElement, end: HTMLElement }} parts
 */
export function createLogPane(doc, { head, lines, end }) {
  /** What the pane last drew: a change here draws everything again. */
  let drawn = { generation: -1, filter: "", timestamps: false, first: 0 };
  /** The number of the last line drawn. */
  let last = -1;

  const atBottom = () => lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24;

  const line = (/** @type {LogsView["lines"][number]} */ l, /** @type {boolean} */ timestamps) => {
    const node = doc.createElement("div");
    node.className = `line ${l.stream}`;
    node.dataset.n = String(l.n);
    if (timestamps && l.time) {
      const time = doc.createElement("span");
      time.className = "time";
      time.textContent = l.time.replace("T", " ").replace(/\.\d+/, "").replace("Z", "");
      node.append(time);
    }
    if (l.source) {
      const source = doc.createElement("span");
      source.className = "source";
      source.textContent = l.source;
      node.append(source);
    }
    node.append(doc.createTextNode(l.text));
    return node;
  };

  return {
    /** @param {LogsView} model */
    render(model) {
      const follow = model.follow && model.running;
      const stick = atBottom();
      const full =
        model.generation !== drawn.generation ||
        model.filter !== drawn.filter ||
        model.timestamps !== drawn.timestamps ||
        model.first < drawn.first;
      if (full) {
        lines.replaceChildren(
          ...model.lines
            .filter((l) => matches(l, model.filter))
            .map((l) => line(l, model.timestamps)),
        );
      } else {
        // Lines that left the ring go from the top; new ones are appended.
        while (
          lines.firstElementChild &&
          Number(/** @type {HTMLElement} */ (lines.firstElementChild).dataset.n) < model.first
        )
          lines.firstElementChild.remove();
        const fresh = model.lines.filter((l) => l.n > last && matches(l, model.filter));
        if (fresh.length) lines.append(...fresh.map((l) => line(l, model.timestamps)));
      }
      last = model.lines.at(-1)?.n ?? last;
      if (full && model.lines.length === 0) last = model.first - 1;
      drawn = {
        generation: model.generation,
        filter: model.filter,
        timestamps: model.timestamps,
        first: model.first,
      };
      const state = model.running ? (follow ? "following" : "reading") : "stopped";
      head.textContent = `${model.title}${model.filter ? ` · lines with “${model.filter}”` : ""}`;
      head.dataset.state = state;
      end.textContent =
        model.ended || (model.lines.length === 0 && !model.running ? "No log lines." : "");
      if (full || (follow && stick)) lines.scrollTop = lines.scrollHeight;
    },
    end() {
      lines.scrollTop = lines.scrollHeight;
    },
    top() {
      lines.scrollTop = 0;
    },
  };
}
