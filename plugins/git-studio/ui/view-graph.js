// The commit graph: one row a commit (and the WIP row above HEAD while the working copy changes),
// with its branches and tags, the lanes, the message, author, date and id. Only the rows on screen
// are in the document; each draws its own slice of the lanes from layoutGraph's segments.

import { WIP } from "./app.js";
import { h, icon, svg } from "./dom.js";
import { authorColor, chartColor, fullDate, initials, relativeTime, shortSha } from "./format.js";
import { layoutGraph, segmentPath } from "./graph.js";
import { changeCount } from "./parse-status.js";
import { refPill, refsByCommit } from "./refs.js";

export const ROW = 34;
const LANE = 22;
const PAD = 6;
const MAX_LANES = 16;
const OVERSCAN = 12;

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./parse.js").Commit} Commit
 * @typedef {{ sha: string, parents: string[], commit: Commit | null }} Item
 * @typedef {{ onMenu?(event: MouseEvent, item: Item): void, onOpen?(item: Item): void,
 *   onDropRef?(ref: string, target: Item): void }} Hooks
 */

/** @param {App} app @param {HTMLElement} host @param {Hooks} [hooks] */
export function createGraphView(app, host, hooks = {}) {
  const header = h(
    "div.graph-head",
    { role: "row" },
    h("span.col-refs", { role: "columnheader" }, "Branch / Tag"),
    h("span.col-graph", { role: "columnheader" }, "Graph"),
    h("span.col-message", { role: "columnheader" }, "Commit message"),
    h("span.col-author", { role: "columnheader" }, "Author"),
    h("span.col-date", { role: "columnheader" }, "Date"),
    h("span.col-sha", { role: "columnheader" }, "Commit"),
  );
  const spacer = h("div.graph-spacer");
  const rowsEl = h("div.graph-rows", { role: "presentation" });
  const moreButton = h(
    "button.desk-btn.desk-btn-quiet.graph-more",
    { type: "button", onClick: () => app.more() },
    "Load more commits",
  );
  const scroller = h(
    "div.graph-scroll",
    { tabindex: 0, role: "grid", "aria-label": "Commit graph", "aria-rowcount": 0 },
    spacer,
    rowsEl,
  );
  host.replaceChildren(h("div.graph", null, header, scroller));

  /** @type {Item[]} */
  let items = [];
  /** @type {import("./graph.js").Row[]} */
  let rows = [];
  let lanes = 1;
  /** @type {Map<string, import("./parse.js").Ref[]>} */
  let refs = new Map();
  /** @type {Set<string> | null} */
  let matches = null;
  let frame = 0;

  function rebuild() {
    const { snapshot, query } = app.get();
    if (!snapshot) {
      items = [];
      rows = [];
    } else {
      const wip = changeCount(snapshot.status) > 0;
      items = [
        ...(wip
          ? [{ sha: WIP, parents: snapshot.status.oid ? [snapshot.status.oid] : [], commit: null }]
          : []),
        ...snapshot.commits.map((commit) => ({ sha: commit.sha, parents: commit.parents, commit })),
      ];
      const layout = layoutGraph(items);
      rows = layout.rows;
      lanes = Math.min(MAX_LANES, Math.max(1, layout.width));
      refs = refsByCommit(snapshot.refs);
    }
    matches = matchSet(items, query);
    const graphWidth = PAD * 2 + lanes * LANE;
    host.style.setProperty("--graph-width", `${graphWidth}px`);
    spacer.style.height = `${items.length * ROW + (snapshot?.more ? ROW * 2 : 0)}px`;
    scroller.setAttribute("aria-rowcount", String(items.length));
    draw();
  }

  function draw() {
    frame = 0;
    const { selected, snapshot } = app.get();
    const top = scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((top + scroller.clientHeight) / ROW) + OVERSCAN);
    const out = [];
    for (let i = first; i < last; i++) {
      const item = /** @type {Item} */ (items[i]);
      out.push(
        drawRow(
          item,
          /** @type {import("./graph.js").Row} */ (rows[i]),
          i,
          item.sha === selected,
          snapshot,
        ),
      );
    }
    if (snapshot?.more && last >= items.length) {
      moreButton.style.top = `${items.length * ROW + ROW / 2}px`;
      out.push(moreButton);
    }
    rowsEl.replaceChildren(...out);
  }

  /**
   * @param {Item} item @param {import("./graph.js").Row} row @param {number} index @param {boolean} selected
   * @param {import("./repo.js").Snapshot | null} snapshot
   */
  function drawRow(item, row, index, selected, snapshot) {
    const head = snapshot?.status.oid ?? null;
    const commit = item.commit;
    const dim = matches !== null && !matches.has(item.sha);
    const el = h(
      "div.graph-row",
      {
        role: "row",
        "aria-rowindex": index + 1,
        "aria-selected": selected ? "true" : "false",
        class: [
          item.sha === WIP ? "is-wip" : "",
          item.sha === head ? "is-head" : "",
          dim ? "is-dim" : "",
        ].join(" "),
        style: { top: `${index * ROW}px`, "--lane-color": chartColor(row.color) },
        dataset: { sha: item.sha },
        onClick: () => void app.select(item.sha),
        onDblclick: () => hooks.onOpen?.(item),
        onContextmenu: (/** @type {MouseEvent} */ event) => {
          event.preventDefault();
          void app.select(item.sha);
          hooks.onMenu?.(event, item);
        },
        onDragover: (/** @type {DragEvent} */ event) => {
          if (!event.dataTransfer?.types.includes("application/x-git-ref")) return;
          event.preventDefault();
          el.classList.add("is-drop");
        },
        onDragleave: () => el.classList.remove("is-drop"),
        onDrop: (/** @type {DragEvent} */ event) => {
          el.classList.remove("is-drop");
          const ref = event.dataTransfer?.getData("application/x-git-ref");
          if (ref) hooks.onDropRef?.(ref, item);
        },
      },
      h("span.col-refs", null, refCell(item, row)),
      h("span.col-graph", null, graphCell(item, row, item.sha === head)),
      h("span.col-message", null, messageCell(item, snapshot)),
      h("span.col-author", null, commit ? commit.author : ""),
      h(
        "span.col-date",
        { title: commit ? fullDate(commit.date) : "" },
        commit ? relativeTime(commit.date) : "",
      ),
      h("span.col-sha", null, commit ? shortSha(commit.sha) : ""),
    );
    return el;
  }

  /** @param {Item} item @param {import("./graph.js").Row} row */
  function refCell(item, row) {
    const here = refs.get(item.sha) ?? [];
    if (item.sha === WIP || here.length === 0) return null;
    const [first, ...rest] = here;
    if (!first) return null;
    return h(
      "span.ref-stack",
      { title: here.map((r) => r.name).join("\n") },
      refPill(first, row.color, { draggable: true }),
      rest.length > 0 ? h("span.ref-more", null, `+${rest.length}`) : null,
    );
  }

  /** @param {Item} item @param {import("./graph.js").Row} row @param {boolean} isHead */
  function graphCell(item, row, isHead) {
    const width = PAD * 2 + lanes * LANE;
    const el = svg("svg", { width, height: ROW, viewBox: `0 0 ${width} ${ROW}`, class: "lanes" });
    const size = { height: ROW, laneWidth: LANE, pad: PAD };
    for (const segment of row.segments) {
      if (segment.from >= MAX_LANES && segment.to >= MAX_LANES) continue;
      const path = svg("path", { d: segmentPath(segment, size), class: "lane" });
      path.style.stroke = chartColor(segment.color);
      if (item.sha === WIP && segment.kind === "out") path.classList.add("lane-wip");
      el.append(path);
    }
    const cx = PAD + Math.min(row.lane, MAX_LANES - 1) * LANE + LANE / 2;
    const cy = ROW / 2;
    const color = chartColor(row.color);
    if (item.sha === WIP) {
      const ring = svg("circle", { cx, cy, r: 8, class: "node-wip" });
      ring.style.stroke = color;
      el.append(ring);
    } else if (row.merge) {
      const dot = svg("circle", { cx, cy, r: 5, class: "node-merge" });
      dot.style.fill = color;
      el.append(dot);
    } else {
      if (isHead) {
        const ring = svg("circle", { cx, cy, r: 13, class: "node-head" });
        ring.style.stroke = color;
        el.append(ring);
      }
      const dot = svg("circle", { cx, cy, r: 10, class: "node" });
      dot.style.fill = item.commit
        ? chartColor(authorColor(item.commit.email || item.commit.author))
        : color;
      dot.style.stroke = color;
      const label = svg("text", {
        x: cx,
        y: cy,
        class: "node-text",
        "text-anchor": "middle",
        "dominant-baseline": "central",
      });
      label.textContent = item.commit ? initials(item.commit.author) : "";
      el.append(dot, label);
    }
    return el;
  }

  /** @param {Item} item @param {import("./repo.js").Snapshot | null} snapshot */
  function messageCell(item, snapshot) {
    if (item.sha === WIP && snapshot) {
      const { staged, unstaged, conflicts } = snapshot.status;
      return h(
        "span.wip-message",
        null,
        h(
          "span.wip-title",
          null,
          snapshot.operation ? `${snapshot.operation} in progress` : "Work in progress",
        ),
        conflicts.length
          ? h(
              "span.wip-count.is-conflict",
              { title: "Conflicts" },
              icon("alert", 12),
              conflicts.length,
            )
          : null,
        unstaged.length
          ? h("span.wip-count", { title: "Unstaged" }, icon("edit", 12), unstaged.length)
          : null,
        staged.length
          ? h("span.wip-count.is-staged", { title: "Staged" }, icon("check", 12), staged.length)
          : null,
      );
    }
    return h("span.message-text", null, item.commit?.subject ?? "");
  }

  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };
  scroller.addEventListener("scroll", schedule);
  new ResizeObserver(schedule).observe(scroller);
  scroller.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    event.preventDefault();
    const at = items.findIndex((item) => item.sha === app.get().selected);
    if (event.key === "Enter") {
      const item = items[at];
      if (item) hooks.onOpen?.(item);
      return;
    }
    const next =
      items[Math.max(0, Math.min(items.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      void app.select(next.sha);
      reveal(next.sha);
    }
  });

  /** Scroll so the row of `sha` is on screen. */
  function reveal(/** @type {string} */ sha) {
    const at = items.findIndex((item) => item.sha === sha);
    if (at < 0) return false;
    const y = at * ROW;
    if (y < scroller.scrollTop) scroller.scrollTop = y - ROW;
    else if (y + ROW > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = y - scroller.clientHeight + ROW * 2;
    schedule();
    return true;
  }

  app.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot || state.query !== previous.query) rebuild();
    else if (state.selected !== previous.selected) schedule();
  });
  rebuild();
  return { reveal, focus: () => scroller.focus(), items: () => items };
}

/** The ids of the commits whose message, author, id or refs hold every word of `query`. */
export function matchSet(/** @type {Item[]} */ items, /** @type {string} */ query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const found = new Set();
  for (const item of items) {
    const c = item.commit;
    if (!c) continue;
    const text = `${c.subject} ${c.author} ${c.email} ${c.sha}`.toLowerCase();
    if (words.every((word) => text.includes(word))) found.add(item.sha);
  }
  return found;
}
