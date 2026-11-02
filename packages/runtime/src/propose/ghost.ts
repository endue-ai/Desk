/**
 * A proposed profile as a ghost: each desktop it lays out drawn small in the shell's 1440x900 frame
 * with its windows as outlines, then the plugins it turns on and off and the settings it changes.
 * Nothing here is live; the card shows it before the profile is kept.
 */

/** One window a profile places, in the 1440x900 frame. */
export interface GhostWindow {
  id: string;
  plugin: string;
  /** The plugin's name. */
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProfileModel {
  id: string;
  name: string;
  description?: string;
  /** The desktops it lays out, in order. */
  desktops: Array<{ desktop: number; windows: GhostWindow[] }>;
  /** Plugins the switch turns on, and off. */
  on: Array<{ id: string; name: string }>;
  off: Array<{ id: string; name: string }>;
  /** How many installed plugins stay as they are. */
  same: number;
  /** Settings whose value in force changes. */
  settings: Array<{ name: string; from: unknown; to: unknown }>;
}

export const FRAME = { width: 1440, height: 900 } as const;

type Make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => HTMLElementTagNameMap[K];

const percent = (value: number, of: number) =>
  `${Math.round((Math.min(Math.max(value, 0), of) / of) * 1000) / 10}%`;

/** A setting's value as people read it: on and off, numbers and words as they are, the rest as JSON. */
export function valueText(value: unknown): string {
  if (value === true) return "on";
  if (value === false) return "off";
  if (value === undefined || value === null) return "not set";
  if (typeof value === "string" || typeof value === "number") return String(value);
  const json = JSON.stringify(value);
  return json.length > 40 ? `${json.slice(0, 39)}…` : json;
}

export function drawProfile(doc: Document, model: ProfileModel): HTMLElement {
  const make: Make = (tag, className, text) => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const body = make("div", "ghost");
  if (model.description) body.append(make("p", "ghost-description", model.description));

  const desktops = make("div", "ghost-desktops");
  for (const { desktop, windows } of model.desktops) {
    const figure = make("figure", "ghost-desktop");
    figure.dataset.desktop = String(desktop);
    figure.setAttribute(
      "aria-label",
      `Desktop ${desktop}: ${windows.map((w) => w.title).join(", ")}`,
    );
    const frame = make("div", "ghost-frame");
    for (const w of windows) {
      const el = make("div", "ghost-window", w.title);
      el.dataset.plugin = w.plugin;
      el.style.left = percent(w.x, FRAME.width);
      el.style.top = percent(w.y, FRAME.height);
      el.style.width = percent(w.w, FRAME.width);
      el.style.height = percent(w.h, FRAME.height);
      frame.append(el);
    }
    figure.append(frame, make("figcaption", "ghost-caption", `Desktop ${desktop}`));
    desktops.append(figure);
  }
  if (model.desktops.length === 0)
    desktops.append(make("p", "ghost-empty", "It lays out no windows."));
  body.append(desktops);

  const plugins = make("div", "ghost-plugins");
  for (const [change, label, list] of [
    ["on", "Turns on", model.on],
    ["off", "Turns off", model.off],
  ] as const) {
    if (list.length === 0) continue;
    const group = make("div", "ghost-group");
    group.dataset.change = change;
    group.append(make("h3", "ghost-label", label));
    const items = make("ul", "ghost-chips");
    for (const plugin of list) {
      const li = make("li", "ghost-chip", plugin.name);
      li.title = plugin.id;
      items.append(li);
    }
    group.append(items);
    plugins.append(group);
  }
  const s = model.same === 1 ? "" : "s";
  const stays = model.same === 1 ? "stays as it is" : "stay as they are";
  const others = model.on.length + model.off.length ? "other " : "";
  plugins.append(make("p", "ghost-same", `${model.same} ${others}plugin${s} ${stays}.`));
  body.append(plugins);

  if (model.settings.length) {
    const table = make("table", "ghost-settings");
    const head = make("tr");
    for (const title of ["Setting", "Now", "Then"]) head.append(make("th", "", title));
    table.append(make("thead"), make("tbody"));
    table.tHead?.append(head);
    for (const { name, from, to } of model.settings) {
      const row = make("tr");
      row.append(
        make("td", "", name),
        make("td", "", valueText(from)),
        make("td", "", valueText(to)),
      );
      table.tBodies[0]?.append(row);
    }
    body.append(table);
  }
  return body;
}
