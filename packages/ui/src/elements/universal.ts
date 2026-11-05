import type { UniversalData, UniversalEntry, UniversalType, UniversalView } from "@endue-ai/bridge";
import {
  agentOf,
  type CalendarRange,
  calendarOf,
  chatOf,
  kanbanOf,
  listOf,
  movedTo,
  rowsOf,
  textOf,
  timelineOf,
  type UniversalEnv,
  type UniversalRow,
} from "../universal";
import { activeIn, Base, element, reflect, shadow } from "./base";
import { universalCss } from "./universal-css";
import {
  type Drawing,
  drawAgent,
  drawCalendar,
  drawChat,
  drawKanban,
  drawList,
  drawText,
  drawTimeline,
} from "./universal-draw";
import { keyMove } from "./universal-keys";

/** A view as the element reads it: everything a UniversalView says but where the entries come from. */
export type DeskUniversalViewSpec = Omit<UniversalView, "source"> &
  Partial<Pick<UniversalView, "source">>;
/** What `desk-select` carries: the row and the entry as the source gave it. */
export type DeskUniversalSelectDetail = { row: UniversalRow; entry: UniversalEntry };
/** `desk-move` (cancelable): a card moved between columns. Not cancelled, the element moves it. */
export type DeskUniversalMoveDetail = DeskUniversalSelectDetail & { from: string; to: string };
/** `desk-send` (cancelable): the composer's text. Not cancelled, the composer empties. */
export type DeskUniversalSendDetail = { text: string };
/** `desk-type`: the person switched the presentation. */
export type DeskUniversalTypeDetail = { type: UniversalType };
/** `desk-range`: the calendar moved to another period. */
export type DeskUniversalRangeDetail = { anchor: string; range: CalendarRange };

const LABELS: Record<UniversalType, string> = {
  timeline: "Timeline",
  calendar: "Calendar",
  kanban: "Board",
  list: "List",
  text: "Text",
  chat: "Chat",
  agent: "Agent",
};
const MESSAGES: Record<string, string> = {
  loading: "Loading…",
  error: "The source did not answer.",
  denied: "Desk may not read this source yet.",
};
const TALK = new Set<UniversalType>(["chat", "agent"]);
type Entry = { node: HTMLElement; row: UniversalRow; lane: number };

/**
 * `<desk-universal-view>`: one universal view (ADR 0087) over a universal data document, drawn as a
 * timeline, calendar, kanban, list, text, chat or agent run. Set `view` (a UniversalView; its source is
 * not read) and `data` (UniversalData); attributes `type` (the presentation shown, else the view's),
 * `time-zone`, `locale`, `now` (RFC 3339), `state` (`loading`, `error`, `denied` draw `message`
 * instead of an empty body), `label`, `compose` (a composer without a send command) and `density`.
 *
 * Entries take focus one at a time: arrows, Home and End move; Enter, Space and a click fire
 * `desk-select`. On a board, Left and Right change column and Shift with them (or a drag) moves the
 * card: `desk-move`. The switcher fires `desk-type`, the calendar's buttons `desk-range`, and the
 * composer (Enter sends, Shift+Enter breaks the line) `desk-send`.
 */
export class DeskUniversalView extends Base {
  static readonly styles = universalCss;
  static readonly observedAttributes = [
    "type",
    "time-zone",
    "locale",
    "now",
    "state",
    "message",
    "label",
    "compose",
  ];
  readonly #title = element("h2", { class: "title", part: "title" });
  readonly #switch = element("div", { role: "tablist", class: "switch", "aria-label": "Show as" });
  readonly #status = element("div", { class: "status", role: "status", part: "status" });
  readonly #body = element("div", { class: "body", part: "body" });
  readonly #input = element("textarea", { rows: "2" }) as HTMLTextAreaElement;
  readonly #send = element("button", { type: "button", class: "send" });
  readonly #compose = element("div", { class: "compose", part: "compose" });
  #view: DeskUniversalViewSpec | null = null;
  #data: UniversalData | null = null;
  #rows: UniversalRow[] = [];
  #entries: Entry[] = [];
  #active: string | null = null;
  #anchor: string | undefined;
  #dragging: UniversalRow | null = null;

  constructor() {
    super();
    const head = element("div", { class: "head", part: "head" });
    head.append(this.#title, this.#switch);
    this.#input.value = "";
    this.#send.textContent = "Send";
    this.#compose.append(this.#input, this.#send);
    const view = element("div", { class: "view", part: "view" });
    view.append(head, this.#status, this.#body, this.#compose);
    shadow(this, universalCss, [view], { delegatesFocus: true });
    this.#body.addEventListener("keydown", this.#onKeyDown);
    this.#body.addEventListener("click", this.#onClick);
    this.#input.addEventListener("keydown", this.#onComposeKey);
    this.#send.addEventListener("click", () => this.#sendText());
    this.#render();
  }

  get view(): DeskUniversalViewSpec | null {
    return this.#view;
  }

  set view(view: DeskUniversalViewSpec | null) {
    this.#view = view;
    this.#anchor = undefined;
    this.#render();
  }

  get data(): UniversalData | null {
    return this.#data;
  }

  set data(data: UniversalData | null) {
    this.#data = data;
    this.#render();
  }

  /** The rows as drawn: the entries read through the maps. */
  get rows(): UniversalRow[] {
    return this.#rows;
  }

  /** The presentation shown now. */
  get type(): UniversalType {
    return (this.getAttribute("type") as UniversalType | null) ?? this.#view?.type ?? "list";
  }

  set type(type: UniversalType) {
    this.setAttribute("type", type);
  }

  /** The composer's text: what the person is writing, or what to put back after a failed send. */
  get draft(): string {
    return String(this.#input.value ?? "");
  }

  set draft(text: string) {
    this.#input.value = text;
  }

  /** The row a node of the view belongs to, or null: for a page's context menu. */
  entryOf(node: EventTarget | null): UniversalRow | null {
    return this.#entryAt(node)?.row ?? null;
  }

  /** Give focus to the entry with this key, when it is drawn. */
  focusEntry(key: string): void {
    const found = this.#entries.find((entry) => entry.row.key === key);
    if (found) this.#focus(found);
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #env(): UniversalEnv {
    const now = Date.parse(this.getAttribute("now") ?? "");
    const zone = this.getAttribute("time-zone") ?? this.#view?.options?.zone;
    const locale = this.getAttribute("locale") ?? undefined;
    return {
      now: Number.isNaN(now) ? Date.now() : now,
      ...(zone ? { zone } : {}),
      ...(locale ? { locale } : {}),
    };
  }

  #render(): void {
    const root = this.shadowRoot;
    const hadFocus = !!root && !!activeIn(this) && this.#entryAt(root.activeElement) !== null;
    const env = this.#env();
    const view = this.#view;
    this.#rows = rowsOf(this.#data, { ...(view?.map ? { map: view.map } : {}), ...env });
    const type = this.type;
    this.#title.textContent = this.getAttribute("label") ?? view?.title ?? this.#data?.title ?? "";
    this.#title.hidden = !this.#title.textContent;
    this.#drawSwitch(type);
    this.#entries = [];
    // A board's columns are lanes 0, 1, ...; every other presentation is one lane.
    let lane = -1;
    const drawing: Drawing = {
      make: (row, tag = "div") => {
        const node = element(tag, { class: "entry", role: "listitem", tabindex: "-1" });
        node.setAttribute("data-key", row.key);
        if (row.status) node.setAttribute("data-tone", row.tone);
        this.#entries.push({ node, row, lane: Math.max(lane, 0) });
        return node;
      },
      lane: () => {
        lane += 1;
      },
    };
    this.#body.replaceChildren(this.#draw(type, env, drawing));
    this.#body.setAttribute("data-type", type);
    this.#drawStatus(type);
    const talk = TALK.has(type) && (!!view?.send || this.hasAttribute("compose"));
    this.#compose.hidden = !talk;
    const hint = view?.options?.placeholder ?? "Write a message";
    this.#input.setAttribute("placeholder", hint);
    this.#input.setAttribute("aria-label", hint);
    const active =
      this.#entries.find((entry) => entry.row.key === this.#active) ?? this.#entries[0] ?? null;
    this.#active = active?.row.key ?? null;
    active?.node.setAttribute("tabindex", "0");
    if (hadFocus && active) active.node.focus();
  }

  #draw(type: UniversalType, env: UniversalEnv, d: Drawing): HTMLElement {
    const options = this.#view?.options ?? {};
    const rows = this.#rows;
    switch (type) {
      case "timeline":
        return drawTimeline(timelineOf(rows, env, options.order ?? "asc"), d);
      case "calendar": {
        const range = options.range ?? "month";
        const model = calendarOf(rows, env, {
          range,
          ...(this.#anchor ? { anchor: this.#anchor } : {}),
        });
        return drawCalendar(model, d, (anchor) => {
          this.#anchor = anchor;
          this.#render();
          const detail: DeskUniversalRangeDetail = { anchor, range };
          this.dispatchEvent(
            new CustomEvent("desk-range", { bubbles: true, composed: true, detail }),
          );
        });
      }
      case "kanban":
        return drawKanban(kanbanOf(rows, options.groups ?? []), d, {
          start: (row) => {
            this.#dragging = row;
          },
          drop: (group) => {
            const row = this.#dragging;
            this.#dragging = null;
            if (row) this.#move(row, group);
          },
        });
      case "text":
        return drawText(textOf(rows), d);
      case "chat":
        return drawChat(chatOf(rows, env, options.me), d);
      case "agent":
        return drawAgent(agentOf(rows, env), d);
      default:
        return drawList(listOf(rows, options.order), d);
    }
  }

  #drawSwitch(type: UniversalType): void {
    const types = [...(this.#view?.types ?? [])];
    if (!types.includes(type)) types.unshift(type);
    this.#switch.hidden = types.length < 2;
    this.#switch.replaceChildren(
      ...types.map((each) => {
        const tab = element("button", {
          type: "button",
          role: "tab",
          "data-type": each,
          "aria-selected": String(each === type),
          tabindex: each === type ? "0" : "-1",
        });
        tab.textContent = LABELS[each] ?? each;
        tab.addEventListener("click", () => this.#switchTo(each));
        return tab;
      }),
    );
  }

  #switchTo(type: UniversalType): void {
    if (type === this.type) return;
    this.setAttribute("type", type);
    const detail: DeskUniversalTypeDetail = { type };
    this.dispatchEvent(new CustomEvent("desk-type", { bubbles: true, composed: true, detail }));
  }

  #drawStatus(type: UniversalType): void {
    const state = this.getAttribute("state") ?? "";
    const busy = state in MESSAGES;
    const empty = this.#rows.length === 0;
    const text = busy
      ? (this.getAttribute("message") ?? MESSAGES[state] ?? "")
      : empty
        ? (this.#view?.empty ?? "Nothing here")
        : "";
    this.#status.textContent = text;
    this.#status.hidden = !text;
    reflect(this.#status, "data-state", text ? (busy ? state : "empty") : null);
    // A board's columns and a calendar's days are worth seeing empty; a busy source draws none.
    this.#body.hidden = empty && (busy || (type !== "kanban" && type !== "calendar"));
  }

  #entryAt(node: EventTarget | null): Entry | null {
    for (let at = node as Node | null; at && at !== this.#body; at = at.parentNode) {
      const found = this.#entries.find((entry) => entry.node === at);
      if (found) return found;
    }
    return null;
  }

  #focus(entry: Entry): void {
    for (const each of this.#entries) each.node.setAttribute("tabindex", "-1");
    entry.node.setAttribute("tabindex", "0");
    this.#active = entry.row.key;
    entry.node.focus();
    entry.node.scrollIntoView?.({ block: "nearest" });
  }

  #select(entry: Entry): void {
    this.#focus(entry);
    const detail: DeskUniversalSelectDetail = { row: entry.row, entry: entry.row.entry };
    this.dispatchEvent(new CustomEvent("desk-select", { bubbles: true, composed: true, detail }));
  }

  #move(row: UniversalRow, to: string): void {
    if (row.group === to) return;
    const detail: DeskUniversalMoveDetail = { row, entry: row.entry, from: row.group, to };
    const event = new CustomEvent("desk-move", {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail,
    });
    if (!this.dispatchEvent(event) || !this.#data) return;
    const focused = this.#entryAt(this.shadowRoot?.activeElement ?? null)?.row.key === row.key;
    this.#active = row.key;
    this.#data = movedTo(this.#data, row, to, this.#view?.map);
    this.#render();
    if (focused) this.focusEntry(row.key);
  }

  #sendText(): void {
    const text = String(this.#input.value ?? "").trim();
    if (!text) return;
    const detail: DeskUniversalSendDetail = { text };
    const event = new CustomEvent("desk-send", {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail,
    });
    if (this.dispatchEvent(event)) this.#input.value = "";
  }

  #onComposeKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.#sendText();
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    const entry = this.#entryAt(event.target);
    if (!entry) return;
    const type = this.type;
    const layout = type === "kanban" ? "board" : type === "calendar" ? "grid" : "line";
    const move = keyMove(this.#entries, entry, event.key, event.shiftKey, layout);
    if (!move) return;
    event.preventDefault();
    if ("select" in move) this.#select(entry);
    else if ("shift" in move) this.#shift(entry.row, move.shift);
    else this.#focus(move.focus);
  };

  /** Move a card to the column beside its own. */
  #shift(row: UniversalRow, step: -1 | 1): void {
    const columns = kanbanOf(this.#rows, this.#view?.options?.groups ?? []);
    const index = columns.findIndex((column) => column.group === row.group);
    const target = columns[index + step];
    if (target) this.#move(row, target.group);
  }

  #onClick = (event: MouseEvent): void => {
    const entry = this.#entryAt(event.target);
    if (entry) this.#select(entry);
  };
}
