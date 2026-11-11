/**
 * Rows drawn from what is declared (`contributes.settings`, CORE_SETTINGS): Settings › Plugins for
 * every enabled plugin, and General's rows for core settings no hand-written panel shows. An edit
 * is in force at once in the runtime's settings and kept in the preferences record, as the core
 * settings are (specs/runtime/v0/settings.md). Arrays and objects are left to init.yaml.
 */
import type { SettingContribution } from "@endue-ai/bridge";
import { CORE_SETTINGS, PERSONAL_KEYS, SEQUENCE_TIMEOUT } from "../core/defaults";
import type { Preferences } from "../core/preferences";
import type { PolicyHub } from "../hub";
import { fits } from "../settings";
import { h } from "../shell/dom";
import { type SettingsCopy, type SettingsLanguage, settingsText } from "./copy";
import { jumpHeading, jumpIndex } from "./jump";
import type { SettingsSection } from "./panels";

export interface DeclaredDeps {
  hub: Pick<PolicyHub, "policy" | "plugins" | "settings">;
  preferences: Pick<Preferences, "set">;
  language: SettingsLanguage;
  /** The window's search: while it holds words, only the rows matching all of them show. */
  query?: string;
  /** Open the window that turns plugins on and off, when there is one. */
  openPlugins?: () => void;
}

/** Core settings a hand-written panel already shows. */
const DRAWN = new Set([
  PERSONAL_KEYS,
  SEQUENCE_TIMEOUT,
  "desk.theme.scheme",
  "desk.theme.contrast",
  "desk.theme.motion",
  "desk.notify.dnd",
  "desk.wallpaper.scene",
]);
const SHOWN = new Set(["boolean", "string", "integer", "number"]);

interface Entry {
  key: string;
  setting: SettingContribution;
  title: string;
  /** What the search looks in: the plugin, the key, the title and the description. */
  words: string;
}
interface Group {
  id: string;
  name: string;
  entries: Entry[];
}

/** The key after its owner's id, as words: `week-start` of `endue.calendar` reads "Week start". */
export function settingTitle(key: string, owner: string): string {
  const rest = key.startsWith(`${owner}.`) ? key.slice(owner.length + 1) : key;
  const words = rest.replace(/[-_.]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A choice as a drop-down shows it: one plain word starts with a capital ("previous" reads
 * "Previous"); a name such as `utf-8` or `euc-kr` is shown as written. The value stays as it is. */
export function choiceText(value: string): string {
  return /^[a-z]+$/.test(value) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function entry(key: string, owner: string, setting: SettingContribution, context: string): Entry {
  const title = settingTitle(key, owner);
  const words = [context, key, title, setting.description ?? ""].join(" ").toLowerCase();
  return { key, setting, title, words };
}

/** The enabled plugins' settings, one group per plugin by name; keys the core declares stay out. */
function pluginGroups(hub: DeclaredDeps["hub"]): Group[] {
  const groups = new Map<string, Group>();
  for (const [key, { owner, ...setting }] of Object.entries(hub.policy.settings)) {
    if (Object.hasOwn(CORE_SETTINGS, key) || !SHOWN.has(setting.kind)) continue;
    let group = groups.get(owner);
    if (!group) {
      const name = hub.plugins.find((p) => p.id === owner)?.manifest?.name ?? owner;
      group = { id: owner, name, entries: [] };
      groups.set(owner, group);
    }
    group.entries.push(entry(key, owner, setting, `${group.name} ${owner}`));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function coreEntries(declared: Record<string, SettingContribution>): Entry[] {
  return Object.entries(declared)
    .filter(([key, setting]) => !DRAWN.has(key) && SHOWN.has(setting.kind))
    .map(([key, setting]) => entry(key, "desk", setting, ""));
}

/** The words the window's search finds Plugins and General's generated rows by. */
export function declaredSearch(
  hub: DeclaredDeps["hub"],
  declared: Record<string, SettingContribution> = CORE_SETTINGS,
): Partial<Record<SettingsSection, string>> {
  return {
    plugins: pluginGroups(hub)
      .flatMap((group) => group.entries.map((e) => e.words))
      .join(" "),
    general: coreEntries(declared)
      .map((e) => e.words)
      .join(" "),
  };
}

/** Whether `value` is one the declaration allows: its kind and choices, range and pattern. */
function allowed(setting: SettingContribution, value: unknown): boolean {
  if (!fits(setting, value)) return false;
  if (typeof value === "number")
    return (
      (setting.minimum === undefined || value >= setting.minimum) &&
      (setting.maximum === undefined || value <= setting.maximum)
    );
  if (typeof value !== "string" || !setting.pattern) return true;
  try {
    return new RegExp(setting.pattern, "u").test(value);
  } catch {
    return true;
  }
}

/** The control for one setting's kind; `show` puts the value in force back in it. */
function control(e: Entry, commit: (value: unknown) => void) {
  const { key, setting, title } = e;
  const props = { "aria-label": title, "data-key": `setting-${key}` };
  if (setting.kind === "boolean") {
    const box = h("input", {
      ...props,
      type: "checkbox",
      class: "desk-check",
      onChange: () => commit(box.checked),
    });
    const show = (value: unknown) => {
      box.checked = value === true;
    };
    return { el: box, show };
  }
  if (setting.kind === "string" && setting.choices) {
    const select = h(
      "select",
      { ...props, class: "input", onChange: () => commit(select.value) },
      setting.choices.map((choice) => h("option", { value: choice }, choiceText(choice))),
    );
    const show = (value: unknown) => {
      select.value = String(value);
    };
    return { el: select, show };
  }
  const numeric = setting.kind !== "string";
  const field = h("input", {
    ...props,
    class: "input",
    type: numeric ? "number" : "text",
    ...(numeric
      ? {
          step: setting.kind === "integer" ? "1" : "any",
          min: setting.minimum,
          max: setting.maximum,
        }
      : { spellcheck: "false", autocomplete: "off" }),
    onChange: () => {
      const typed = field.value.trim();
      const value = numeric ? (typed === "" ? Number.NaN : Number(typed)) : field.value;
      if (allowed(setting, value)) {
        field.removeAttribute("aria-invalid");
        commit(value);
      } else field.setAttribute("aria-invalid", "true");
    },
  });
  const show = (value: unknown) => {
    field.value = value === undefined || value === null ? "" : String(value);
    field.removeAttribute("aria-invalid");
  };
  return { el: field, show };
}

function row(e: Entry, { hub: { settings }, preferences, language }: DeclaredDeps): HTMLElement {
  const { key, setting } = e;
  const field = control(e, (value) => {
    preferences.set(key, value);
    sync();
  });
  const reset = h(
    "button",
    {
      type: "button",
      class: "btn btn-xs btn-outline",
      "data-key": `reset-${key}`,
      onClick: () => {
        settings.reset(key);
        sync();
      },
    },
    settingsText(language, "reset"),
  );
  function sync() {
    field.show(settings.get(key, setting.default));
    reset.hidden = !Object.hasOwn(settings.layer("session"), key);
  }
  sync();
  // A person reads the title and what it does; the key init.yaml takes is the search's and the title's.
  return h(
    "div",
    { class: "settings-row", "data-setting": key },
    h(
      "div",
      { class: "settings-row-label", title: key },
      h("span", {}, e.title),
      setting.description ? h("p", {}, setting.description) : null,
    ),
    h("div", { class: "settings-declared-control" }, reset, field.el),
  );
}

const group = (title: string, rows: HTMLElement[], plugin?: string) =>
  h(
    "section",
    { class: "settings-group", "data-plugin": plugin },
    plugin ? jumpHeading("h3", plugin, title) : h("h3", {}, title),
    h("div", { class: "settings-group-rows" }, rows),
  );

/** Settings › Plugins: the way to turn plugins on or off, an index of the plugins, and every
 * enabled plugin's settings, narrowed to the search's rows. */
export function pluginSettings(deps: DeclaredDeps): HTMLElement {
  const tr = (key: SettingsCopy) => settingsText(deps.language, key);
  const groups = pluginGroups(deps.hub);
  const words = (deps.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = (e: Entry) => words.every((word) => e.words.includes(word));
  // A search that found the section by its own name (Plugins) narrows nothing.
  const narrowed = groups.some((g) => g.entries.some(matching));
  const el = h("div", { class: "settings-panel-body" });
  if (deps.openPlugins)
    el.append(
      h(
        "div",
        { class: "settings-group-rows" },
        h(
          "div",
          { class: "settings-row" },
          h(
            "div",
            { class: "settings-row-label" },
            h("span", {}, tr("pluginsOnOff")),
            h("p", {}, tr("pluginsOnOffHint")),
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-xs btn-outline",
              "data-key": "settings-open-plugins",
              onClick: deps.openPlugins,
            },
            tr("openPlugins"),
          ),
        ),
      ),
    );
  const shown = groups
    .map((g) => ({ ...g, entries: narrowed ? g.entries.filter(matching) : g.entries }))
    .filter((g) => g.entries.length > 0);
  const jump = jumpIndex(tr("jumpTo"), shown, () => el);
  if (jump) el.append(jump);
  for (const g of shown)
    el.append(
      group(
        g.name,
        g.entries.map((e) => row(e, deps)),
        g.id,
      ),
    );
  if (groups.length === 0) el.append(h("p", { class: "settings-footnote" }, tr("pluginsEmpty")));
  return el;
}

/** General's rows for core settings no hand-written panel shows; null when there are none. */
export function coreSettings(
  deps: DeclaredDeps,
  declared: Record<string, SettingContribution> = CORE_SETTINGS,
): HTMLElement | null {
  const entries = coreEntries(declared);
  if (entries.length === 0) return null;
  return group(
    settingsText(deps.language, "deskSettings"),
    entries.map((e) => row(e, deps)),
  );
}
