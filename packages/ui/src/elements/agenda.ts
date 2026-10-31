import { Base, childOf, element, reflect, shadow, step, uid } from "./base";
import { compareValues, instant } from "./order";

const css = `
:host {
  display: block;
  box-sizing: border-box;
  border: 1px solid var(--desk-border);
  border-radius: 8px;
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: 13px;
  overflow: auto;
}
:host([hidden]) {
  display: none;
}
[role="listbox"] {
  padding: 4px;
  outline: none;
}
[role="listbox"]:focus-visible {
  outline: 2px solid var(--desk-accent);
  outline-offset: -2px;
}
[role="option"] {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 0 10px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
[role="option"][data-active] {
  background: var(--desk-border);
  color: var(--desk-text);
}
[role="option"][aria-selected="true"] {
  color: var(--desk-accent);
}
[data-past] {
  opacity: 0.6;
}
.time {
  color: var(--desk-text-muted);
  font-variant-numeric: tabular-nums;
}
.detail {
  grid-column: 2;
  color: var(--desk-text-muted);
  font-size: 12px;
}
[role="separator"] {
  height: 0;
  margin: 4px 10px;
  border-top: 2px solid var(--desk-accent);
}
:host([density="compact"]) [role="option"] {
  grid-template-columns: 44px 1fr;
  padding: 2px 6px;
}
:host([density="compact"]) {
  font-size: 12px;
}
`;

/** One event: times are RFC 3339 instants; an all-day event shows no time and comes first. */
export interface DeskAgendaEvent {
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  detail?: string;
}

/** What `desk-select` carries from an agenda: the event's index as shown, and the event. */
export type DeskAgendaSelectDetail = { index: number; event: DeskAgendaEvent };

/**
 * `<desk-agenda label="Schedule" time-zone="Asia/Seoul" now="...">`: a day's `events` in time order,
 * all-day ones first, each with its start time in `time-zone` (and `locale`). A now-line
 * (`role="separator"`, named "Now, 09:00") sits before the first event that starts after `now`, and
 * events that ended by then carry `data-past`. It moves and selects like `desk-list`: arrows, Home and
 * End; Enter, Space and a click fire `desk-select` ({@link DeskAgendaSelectDetail}).
 */
export class DeskAgenda extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["label", "time-zone", "locale", "now"];
  readonly #list = element("div", { role: "listbox", tabindex: "0", part: "list" });
  #events: DeskAgendaEvent[] = [];
  #shown: DeskAgendaEvent[] = [];
  #ids = new Map<DeskAgendaEvent, string>();
  #active: DeskAgendaEvent | null = null;
  #selected: DeskAgendaEvent | null = null;

  constructor() {
    super();
    shadow(this, css, [this.#list], { delegatesFocus: true });
    this.#list.addEventListener("keydown", this.#onKeyDown);
    this.#list.addEventListener("click", this.#onClick);
  }

  get events(): DeskAgendaEvent[] {
    return this.#events;
  }

  set events(events: DeskAgendaEvent[]) {
    this.#events = [...events];
    this.#ids = new Map(this.#events.map((e) => [e, this.#ids.get(e) ?? uid("desk-event")]));
    if (this.#active && !this.#events.includes(this.#active)) this.#active = null;
    if (this.#selected && !this.#events.includes(this.#selected)) this.#selected = null;
    this.#render();
  }

  /** The selected event's index among the events as shown, or -1. */
  get selectedIndex(): number {
    return this.#selected ? this.#shown.indexOf(this.#selected) : -1;
  }

  set selectedIndex(index: number) {
    this.#selected = this.#shown[index] ?? null;
    this.#render();
  }

  /** The event the arrows are on, or null. */
  get activeEvent(): DeskAgendaEvent | null {
    return this.#active;
  }

  get selectedEvent(): DeskAgendaEvent | null {
    return this.#selected;
  }

  /** The event a node of the list belongs to, or null: for a page's context menu. */
  eventOf(node: EventTarget | null): DeskAgendaEvent | null {
    const option = childOf(this.#list, node);
    const index = option?.getAttribute("data-index");
    return index ? (this.#shown[Number(index)] ?? null) : null;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "label") reflect(this.#list, "aria-label", value);
    else this.#render();
  }

  #time(at: number): string {
    const zone = this.getAttribute("time-zone") ?? undefined;
    const locale = this.getAttribute("locale") ?? undefined;
    const options = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(at);
  }

  #render(): void {
    const start = (e: DeskAgendaEvent) => instant(e.start);
    this.#shown = [...this.#events].sort(
      (a, b) =>
        Number(b.allDay === true) - Number(a.allDay === true) ||
        compareValues(start(a), start(b)),
    );
    const now = instant(this.getAttribute("now") ?? Number.NaN);
    const known = !Number.isNaN(now);
    const upcoming = this.#shown.findIndex((e) => !e.allDay && start(e) > now);
    const line = known ? (upcoming < 0 ? this.#shown.length : upcoming) : -1;
    const nodes: HTMLElement[] = this.#shown.map((event, index) => this.#option(event, index, now));
    if (line >= 0) {
      const separator = element("div", { role: "separator", class: "now" });
      separator.setAttribute("aria-label", `Now, ${this.#time(now)}`);
      nodes.splice(line, 0, separator);
    }
    this.#list.replaceChildren(...nodes);
    const active = this.#active ? (this.#ids.get(this.#active) ?? null) : null;
    reflect(this.#list, "aria-activedescendant", active);
  }

  #option(event: DeskAgendaEvent, index: number, now: number): HTMLElement {
    const option = element("div", {
      role: "option",
      id: this.#ids.get(event) ?? uid("desk-event"),
      "aria-selected": String(event === this.#selected),
      "data-index": String(index),
    });
    if (event.allDay) option.setAttribute("data-all-day", "");
    if (event === this.#active) option.setAttribute("data-active", "");
    const ends = instant(event.end ?? event.start);
    if (ends <= now) option.setAttribute("data-past", "");
    const time = element("span", { class: "time" });
    time.textContent = event.allDay ? "All day" : this.#time(instant(event.start));
    const title = element("span", { class: "title" });
    title.textContent = event.title;
    option.append(time, title);
    if (event.detail) {
      const detail = element("span", { class: "detail" });
      detail.textContent = event.detail;
      option.append(detail);
    }
    return option;
  }

  #activate(event: DeskAgendaEvent | null): void {
    this.#active = event;
    this.#render();
    const id = event ? this.#ids.get(event) : undefined;
    for (const child of this.#list.children) if (child.id === id) child.scrollIntoView?.();
  }

  #select(event: DeskAgendaEvent): void {
    this.#selected = event;
    this.#activate(event);
    const detail: DeskAgendaSelectDetail = { index: this.#shown.indexOf(event), event };
    this.dispatchEvent(new CustomEvent("desk-select", { bubbles: true, detail }));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this.#list) return;
    const at = this.#active ? this.#shown.indexOf(this.#active) : -1;
    const next = step(event.key, at, this.#shown.length, false);
    if (next !== null) {
      event.preventDefault();
      this.#activate(this.#shown[next] ?? null);
    } else if ((event.key === "Enter" || event.key === " ") && this.#active) {
      event.preventDefault();
      this.#select(this.#active);
    }
  };

  #onClick = (event: MouseEvent): void => {
    const found = this.eventOf(event.target);
    if (found) this.#select(found);
  };
}
