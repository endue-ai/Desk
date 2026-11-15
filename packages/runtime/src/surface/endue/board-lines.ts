/**
 * The lines of an endue agent's Studio board (ADR 0232): each way in runs to the agent, and the
 * agent to each thing it reaches. A line leaves at a dot and arrives at an arrowhead, solid while
 * its row is on, dashed while it is off or not read here, red for a problem. The board is measured
 * as it is laid out, so a row that unfolds or a window that narrows takes its lines along. Side by
 * side, a line is one curve between a row and the agent; stacked (a narrow window), the lines run
 * down a trunk at the left, each stretch of it in the strongest state that passes through.
 */
import type { LineState } from "./board-model";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A row as the lines see it: where it is, and the height its line meets it at. */
export interface LineRow {
  id: string;
  side: "in" | "out";
  state: LineState;
  /** Unfolded: its line is drawn heavier. */
  selected: boolean;
  box: Box;
  y: number;
}

export interface Geometry {
  hub: Box;
  /** The height the lines meet the agent at, side by side. */
  hubY: number;
  rows: LineRow[];
  stacked: boolean;
  /** Where the trunk stands when stacked. */
  trunkX: number;
}

export interface Path {
  key: string;
  d: string;
  state: LineState;
  width: number;
  dashed: boolean;
}
export interface Port {
  key: string;
  x: number;
  y: number;
  state: LineState;
}
export interface Arrow {
  key: string;
  d: string;
  state: LineState;
}
export interface Lines {
  paths: Path[];
  ports: Port[];
  arrows: Arrow[];
}

const STRENGTH: Record<LineState, number> = { unknown: 0, off: 1, bad: 2, on: 3 };
/** The corner of a branch off the trunk. */
const R = 8;
/** How far from the agent's top and bottom the trunk meets it. */
const HUB_INSET = 28;
const ARROW = 9;

const round = (n: number) => Math.round(n * 10) / 10;
const dashed = (state: LineState) => state === "off" || state === "unknown";
const widthOf = (state: LineState, selected = false) => (selected ? 3 : dashed(state) ? 1.4 : 1.8);

/** The strongest of the states that share a stretch: on, then a problem, then off. */
export function carried(states: readonly LineState[]): LineState {
  return states.reduce<LineState>((a, b) => (STRENGTH[b] > STRENGTH[a] ? b : a), "unknown");
}

/** An arrowhead pointing right, its tip at (x, y). */
function arrow(key: string, x: number, y: number, state: LineState, length = ARROW): Arrow {
  const half = length * 0.55;
  const back = round(x - length);
  return {
    key,
    state,
    d: `M${round(x)} ${round(y)} L${back} ${round(y - half)} L${back} ${round(y + half)} Z`,
  };
}

const stroke = (key: string, d: string, state: LineState, selected = false): Path => ({
  key,
  d,
  state,
  width: widthOf(state, selected),
  dashed: dashed(state),
});

/** Paths in the order they are painted: the weaker first, an unfolded row's last. */
const painted = (paths: (Path & { selected?: boolean })[]): Path[] =>
  paths
    .map((p, i) => ({ p, i, rank: STRENGTH[p.state] + (p.selected ? 4 : 0) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ p: { selected: _selected, ...path } }) => path);

export function buildLines(g: Geometry): Lines {
  return g.stacked ? stacked(g) : sideBySide(g);
}

function sideBySide({ hub, hubY, rows }: Geometry): Lines {
  const ins = rows.filter((r) => r.side === "in");
  const outs = rows.filter((r) => r.side === "out");
  const paths = rows.map((row) => {
    // A curve whose ends run level; it stops at the arrowhead's back.
    const [x1, y1, x2, y2] =
      row.side === "in"
        ? [row.box.right, row.y, hub.left - ARROW + 1, hubY]
        : [hub.right, hubY, row.box.left - ARROW + 1, row.y];
    // The bend is laid halfway to the arrowhead's tip, where the line would end without one.
    const mid = round((x1 + x2 + ARROW - 1) / 2);
    const d = `M${round(x1)} ${round(y1)} C${mid} ${round(y1)} ${mid} ${round(y2)} ${round(x2)} ${round(y2)}`;
    return { ...stroke(row.id, d, row.state, row.selected), selected: row.selected };
  });
  const ports: Port[] = ins.map((r) => ({
    key: r.id,
    x: round(r.box.right),
    y: round(r.y),
    state: r.state,
  }));
  const arrows = outs.map((r) => arrow(r.id, r.box.left, r.y, r.state));
  if (ins.length) arrows.push(arrow("hub-in", hub.left, hubY, carried(ins.map((r) => r.state))));
  if (outs.length)
    ports.push({
      key: "hub-out",
      x: round(hub.right),
      y: round(hubY),
      state: carried(outs.map((r) => r.state)),
    });
  return { paths: painted(paths), ports, arrows };
}

function stacked({ hub, rows, trunkX: x }: Geometry): Lines {
  const byTop = (a: LineRow, b: LineRow) => a.y - b.y;
  const ins = rows.filter((r) => r.side === "in").sort(byTop);
  const outs = rows.filter((r) => r.side === "out").sort(byTop);
  const inY = round(hub.top + HUB_INSET);
  const outY = round(hub.bottom - HUB_INSET);
  const paths: (Path & { selected?: boolean })[] = [];
  const ports: Port[] = [];
  const arrows: Arrow[] = [];
  // An arrowhead between the trunk's corner and a card has little room.
  const head = (tip: number) => Math.max(4, Math.min(ARROW, tip - x - R / 2));
  const reach = (tip: number) => round(Math.max(x + R, tip - head(tip) + 1));

  ins.forEach((row, i) => {
    const y = round(row.y);
    const left = round(row.box.left);
    // The row's branch to the trunk, then the trunk down to the next branch or the agent.
    const branch = `M${left} ${y} H${x + R} Q${x} ${y} ${x} ${y + R}`;
    paths.push({
      ...stroke(`${row.id}:branch`, branch, row.state, row.selected),
      selected: row.selected,
    });
    const next = ins[i + 1];
    const to = next ? round(next.y) : inY - R;
    const from = i === 0 ? y + R : y;
    const state = carried(ins.slice(0, i + 1).map((r) => r.state));
    if (to > from) paths.push(stroke(`${row.id}:trunk`, `M${x} ${from} V${to}`, state));
    ports.push({ key: row.id, x: left, y, state: row.state });
  });
  if (ins.length) {
    const state = carried(ins.map((r) => r.state));
    const d = `M${x} ${inY - R} Q${x} ${inY} ${x + R} ${inY} H${reach(hub.left)}`;
    paths.push(stroke("hub-in", d, state));
    arrows.push(arrow("hub-in", hub.left, inY, state, head(hub.left)));
  }
  if (outs.length) {
    const state = carried(outs.map((r) => r.state));
    const d = `M${round(hub.left)} ${outY} H${x + R} Q${x} ${outY} ${x} ${outY + R}`;
    paths.push(stroke("hub-out", d, state));
    ports.push({ key: "hub-out", x: round(hub.left), y: outY, state });
  }
  outs.forEach((row, j) => {
    const y = round(row.y);
    const left = round(row.box.left);
    const previous = outs[j - 1];
    const from = previous ? round(previous.y) : outY + R;
    const to = j === outs.length - 1 ? y - R : y;
    const state = carried(outs.slice(j).map((r) => r.state));
    if (to > from) paths.push(stroke(`${row.id}:trunk`, `M${x} ${from} V${to}`, state));
    const branch = `M${x} ${y - R} Q${x} ${y} ${x + R} ${y} H${reach(left)}`;
    paths.push({
      ...stroke(`${row.id}:branch`, branch, row.state, row.selected),
      selected: row.selected,
    });
    arrows.push(arrow(row.id, left, y, row.state, head(left)));
  });
  return { paths: painted(paths), ports, arrows };
}

/** A row's line as the board asks for it. */
export type LineSpec = Pick<LineRow, "id" | "side" | "state" | "selected">;

const NS = "http://www.w3.org/2000/svg";
/** Where the trunk stands in the column's left gutter when stacked. */
const TRUNK_INSET = 12;

/** `el`'s box inside `board`, from the layout's own offsets: a card that is turning measures the same. */
function boxIn(el: HTMLElement, board: HTMLElement): Box {
  let left = 0;
  let top = 0;
  for (
    let at: HTMLElement | null = el;
    at && at !== board;
    at = at.offsetParent as HTMLElement | null
  ) {
    left += at.offsetLeft;
    top += at.offsetTop;
  }
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

const middle = (box: Box) => (box.top + box.bottom) / 2;

/** Measure `board` as it is laid out; `null` while it has no agent card or column yet. */
export function measure(board: HTMLElement, specs: readonly LineSpec[]): Geometry | null {
  const one = (selector: string) => board.querySelector<HTMLElement>(selector);
  const hubEl = one("[data-hub]");
  const column = one('[data-col="in"]');
  if (!hubEl || !column) return null;
  const hub = boxIn(hubEl, board);
  const inbound = boxIn(column, board);
  const port = one("[data-hub-port]");
  const rows: LineRow[] = [];
  for (const spec of specs) {
    const row = one(`[data-row="${CSS.escape(spec.id)}"]`);
    const head = row?.querySelector<HTMLElement>("[data-row-head]");
    if (!row) continue;
    rows.push({ ...spec, box: boxIn(row, board), y: middle(boxIn(head ?? row, board)) });
  }
  return {
    hub,
    hubY: middle(port ? boxIn(port, board) : hub),
    rows,
    // The agent's card under the first column instead of beside it: a narrow board.
    stacked: hub.left < inbound.right - 1,
    trunkX: inbound.left + TRUNK_INSET,
  };
}

function draw(svg: SVGSVGElement, lines: Lines, layout: string): void {
  const el = (name: string, attributes: Record<string, string | number | undefined>) => {
    const node = svg.ownerDocument.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes))
      if (value !== undefined) node.setAttribute(key, String(value));
    return node;
  };
  svg.setAttribute("data-layout", layout);
  svg.replaceChildren(
    ...lines.paths.map((p) =>
      el("path", {
        class: "studio-line",
        d: p.d,
        "data-line": p.key,
        "data-state": p.state,
        "data-dashed": p.dashed ? "" : undefined,
        "stroke-width": p.width,
      }),
    ),
    ...lines.ports.map((p) =>
      el("circle", { class: "studio-port", cx: p.x, cy: p.y, r: 4.5, "data-state": p.state }),
    ),
    ...lines.arrows.map((a) =>
      el("path", { class: "studio-arrow", d: a.d, "data-arrow": a.key, "data-state": a.state }),
    ),
  );
}

/** The lines' drawing layer: empty until `boardLines().attach` measures the board. */
export function linesLayer(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "studio-lines");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

/**
 * Keep a board's lines drawn: `attach` after every draw of the board, `dispose` with the window.
 * The board, its columns, its rows and the agent's card are watched, so the lines follow a row that
 * unfolds and a window that changes size; nothing is measured while none of them changes.
 */
export function boardLines(): {
  attach(board: HTMLElement, specs: readonly LineSpec[]): void;
  dispose(): void;
} {
  let observer: ResizeObserver | undefined;
  const dispose = () => {
    observer?.disconnect();
    observer = undefined;
  };
  return {
    attach(board, specs) {
      dispose();
      const svg = board.querySelector<SVGSVGElement>("svg.studio-lines");
      if (!svg) return;
      const again = () => {
        const geometry = measure(board, specs);
        if (geometry) draw(svg, buildLines(geometry), geometry.stacked ? "stacked" : "side");
      };
      again();
      const Observer = board.ownerDocument.defaultView?.ResizeObserver;
      if (!Observer) return;
      observer = new Observer(again);
      observer.observe(board);
      for (const part of board.querySelectorAll("[data-row], [data-hub], [data-col]"))
        observer.observe(part);
    },
    dispose,
  };
}
