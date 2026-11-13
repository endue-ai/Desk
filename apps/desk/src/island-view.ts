// The island's DOM (ADR 0204): the pill, and under it, while open, the panel: the card in front
// (island-card.ts), the asks waiting behind it, the agents at work, and a way to the desk.
import type { PluginInfo } from "@endue-ai/bridge";
import { cardOf, renderCard, titleOf } from "./island-card";
import { type IslandState, summary } from "./island-model";

export interface IslandDraw {
  state: IslandState;
  plugins: PluginInfo[];
  open: boolean;
  /** A line under the card: what came of the last answer, when it failed. */
  said: string;
}

export interface IslandDom {
  pill: HTMLButtonElement;
  desk: HTMLButtonElement;
  panel: HTMLElement;
  /** Draw it; true when the card in front is a new one (or none). */
  draw(view: IslandDraw): boolean;
  /** How tall the window must be, in CSS pixels, to show the open island whole. */
  wanted(): number;
}

export function mountIsland(
  doc: Document,
  root: HTMLElement,
  answer: (choice: string) => void,
): IslandDom {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const island = el("div", "island");
  const pill = el("button", "island-pill");
  pill.type = "button";
  pill.setAttribute("aria-controls", "island-panel");
  const dots = el("span", "island-dots");
  dots.setAttribute("aria-hidden", "true");
  const line = el("span", "island-line");
  const badge = el("span", "island-badge");
  badge.setAttribute("aria-hidden", "true");
  pill.append(dots, line, badge);
  const status = el("p", "island-status");
  status.setAttribute("role", "status");
  const panel = el("section", "island-panel");
  panel.id = "island-panel";
  panel.setAttribute("aria-label", "What is going on");
  const cardSlot = el("div", "island-card-slot");
  const said = el("p", "island-said");
  said.setAttribute("role", "alert");
  const restHeading = el("h2", "island-heading", "Also waiting");
  const restList = el("ul", "island-list");
  const workingList = el("ul", "island-list");
  const desk = el("button", "island-desk", "Open the desk");
  desk.type = "button";
  panel.append(
    cardSlot,
    said,
    restHeading,
    restList,
    el("h2", "island-heading", "At work"),
    workingList,
    desk,
  );
  island.append(pill, status, panel);
  root.replaceChildren(island);

  const rows = (list: HTMLUListElement, texts: Array<[string, string]>, none: string) => {
    if (texts.length === 0) {
      list.replaceChildren(el("li", "island-none", none));
      return;
    }
    list.replaceChildren(
      ...texts.map(([who, what]) => {
        const row = el("li", "island-row");
        row.append(el("span", "island-who", who), el("span", "island-what", what));
        return row;
      }),
    );
  };

  /** The card on screen, by kind and id: a new draw of the same card keeps its DOM and focus. */
  let shown = "";
  let wasOpen = false;
  const draw = ({ state, plugins, open, said: text }: IslandDraw) => {
    const { working, asks } = state;
    const words = summary(state);
    line.textContent = words;
    if (status.textContent !== words) status.textContent = words;
    pill.setAttribute("aria-expanded", String(open));
    pill.setAttribute("aria-label", `${words}. ${open ? "Close" : "Open"} the island`);
    island.dataset.open = String(open);
    island.dataset.asks = String(asks.length);
    island.dataset.working = String(working.length);
    badge.textContent = asks.length > 0 ? String(asks.length) : "";
    badge.hidden = asks.length === 0;
    dots.replaceChildren(
      ...working.slice(0, 3).map((worker) => {
        const dot = el("span", "island-dot");
        if (worker.colour) dot.style.setProperty("--island-dot", worker.colour);
        return dot;
      }),
    );
    panel.hidden = !open;
    const [front, ...rest] = asks;
    const key = front ? `${front.kind}:${front.id}:${rest.length}` : "";
    // A card shows anew when it comes to the front or when the panel opens on it.
    const fresh = front !== undefined && !shown.startsWith(`${front.kind}:${front.id}:`);
    const changed = open && front !== undefined && (fresh || !wasOpen);
    wasOpen = open;
    if (key !== shown) {
      shown = key;
      cardSlot.replaceChildren(
        ...(front ? [renderCard(doc, cardOf(front, plugins, rest.length), answer)] : []),
      );
    }
    said.textContent = text;
    said.hidden = !text;
    restHeading.hidden = rest.length === 0;
    restList.hidden = rest.length === 0;
    rows(
      restList,
      rest.map((ask) => [titleOf(ask, plugins), ""]),
      "",
    );
    rows(
      workingList,
      working.map((w) => [w.name, "working"]),
      asks.length > 0 ? "No agent is working." : "Nothing waits for you, and no agent is working.",
    );
    return changed;
  };

  const wanted = () => {
    const style = doc.defaultView?.getComputedStyle(island);
    const bottom = Number.parseFloat(style?.paddingBottom ?? "0") || 0;
    return Math.ceil(panel.offsetTop + panel.scrollHeight + bottom + 2);
  };

  return { pill, desk, panel, draw, wanted };
}
