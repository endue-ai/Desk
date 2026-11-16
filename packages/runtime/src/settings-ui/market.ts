/**
 * Settings, Market (ADR 0107): every kind the markets offer (market.list), in groups by kind, each
 * with its publisher, licence, version and whether it comes from the endue index. Install always
 * asks first, saying what it would be allowed (or that it asks for nothing) and where an entry that
 * is not verified comes from, before plugin.install runs; code that is not verified does not install.
 * What the market installed can be removed (plugin.remove), after a question too. A theme or a design
 * system it installed is put in force from its row, which says it is in use, and its remove
 * (theme.remove) gives the desk back to the endue one first (#158 finding 19).
 */
import {
  BridgeCallError,
  type BridgeClient,
  type MarketListing,
  type Permission,
} from "@endue-ai/bridge";
import { permissionWords } from "../describe/words";
import { type KeyOf, moduleText } from "../i18n/messages";
import { h, render } from "../shell/dom";
import type { SettingsLanguage } from "./copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const SCOPE = { permission: "plugin:manage" } as const;
const LOOK_SCOPE = { permission: "theme:manage" } as const;
type Kind = MarketListing["entry"]["kind"];
const KINDS: Kind[] = ["view", "pack", "plugin", "theme", "design-system"];

/** How a look the market installed is put in force, read back and given up for the endue one. */
interface Look {
  setting: string;
  use: string;
  reset: string;
}
const LOOKS: Partial<Record<Kind, Look>> = {
  theme: { setting: "desk.theme.active", use: "desk.theme.use", reset: "desk.theme.default" },
  "design-system": {
    setting: "desk.design.active",
    use: "desk.design.use",
    reset: "desk.design.default",
  },
};

export interface MarketOptions {
  bridge: BridgeClient;
  language: SettingsLanguage;
  /** Puts a theme or a design system in force; without it their rows only install. */
  commands?: { run(id: string, args?: unknown): Promise<unknown> };
  /** Where the theme and the design system in force are named. */
  settings?: { get<T>(key: string, fallback?: T): T };
}

const text = moduleText("settingsUi", { en, ko });
type Id = KeyOf<keyof typeof en, "settingsUi">;
type Copy = Id extends `market.${infer K}` ? K : never;
const say = (language: SettingsLanguage, key: Copy, vars?: Record<string, string>) =>
  text(language, `market.${key}` as Id, vars);

/** One permission in words a person reads before allowing it. */
export function permissionText(permission: Permission, language: SettingsLanguage): string {
  const p = permission as Permission & Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.join(", ") : "");
  switch (p.permission) {
    case "data:read":
      return list(p.kinds)
        ? say(language, "dataRead", { kinds: list(p.kinds) })
        : say(language, "dataReadAll");
    case "net:fetch":
      return say(language, "netFetch", { hosts: list(p.hosts) });
    case "fs:read":
      return say(language, "fsRead", { paths: list(p.paths) });
    case "fs:write":
      return say(language, "fsWrite", { paths: list(p.paths) });
    default: {
      const words = permissionWords(permission);
      return say(language, "otherPermission", {
        words: words.charAt(0).toUpperCase() + words.slice(1),
      });
    }
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function mountMarket(options: MarketOptions): {
  el: HTMLElement;
  ready: Promise<void>;
  idle(): Promise<void>;
  dispose(): void;
} {
  const { bridge, language, commands, settings } = options;
  const tr = (key: Copy) => say(language, key);
  const el = h("div", { class: "settings-panel-body settings-market" });
  let entries: MarketListing[] = [];
  /** The entry whose question is open: to install it, or to remove it. */
  let asking: { id: string; remove: boolean } | undefined;
  const alerts = new Map<string, string>();
  let pending: Promise<void> = Promise.resolve();
  let disposed = false;

  async function load() {
    if (disposed) return;
    try {
      entries = (await bridge.call("market.list", { scope: SCOPE })).entries;
    } catch {
      entries = [];
    }
    draw();
  }
  const queue = (id: string, work: () => Promise<unknown>) => {
    pending = pending.then(async () => {
      alerts.delete(id);
      try {
        await work();
      } catch (error) {
        // The core's own words, without the "plugin.install: invalid_params: " a call error starts with.
        const said = error instanceof Error ? error.message : String(error);
        alerts.set(
          id,
          error instanceof BridgeCallError ? said.replace(/^[a-z.]+: [a-z_]+: /, "") : said,
        );
      }
      await load();
    });
    return pending;
  };
  const run = (id: string, args?: unknown) => commands?.run(id, args) ?? Promise.resolve();
  /** The look an installed theme or design system row puts in force; none without the commands. */
  const lookOf = ({ entry, state }: MarketListing) =>
    commands && state !== "available" ? LOOKS[entry.kind] : undefined;
  const inUse = (listing: MarketListing) => {
    const look = LOOKS[listing.entry.kind];
    return (
      look !== undefined &&
      listing.state !== "available" &&
      settings?.get<string>(look.setting, "") === listing.entry.id
    );
  };
  const install = (listing: MarketListing) => {
    asking = undefined;
    const accept = listing.entry.permissions ?? listing.added;
    void queue(listing.entry.id, () =>
      bridge.call("plugin.install", {
        id: listing.entry.id,
        market: listing.market,
        accept,
        scope: SCOPE,
      }),
    );
  };
  const remove = (listing: MarketListing) => {
    asking = undefined;
    const id = listing.entry.id;
    const look = lookOf(listing);
    const using = inUse(listing);
    void queue(id, async () => {
      if (!look) return bridge.call("plugin.remove", { plugin: id, scope: SCOPE });
      // The endue look takes over before the one in force goes.
      if (using) await run(look.reset);
      return bridge.call("theme.remove", { theme: id, scope: LOOK_SCOPE });
    });
  };
  const askFor = (listing: MarketListing, removing: boolean) => {
    asking = { id: listing.entry.id, remove: removing };
    draw();
  };
  const actions = (listing: MarketListing) => {
    const { entry, state, verified } = listing;
    // While its question is open, the question's own buttons are the row's.
    if (asking?.id === entry.id) return h("div", { class: "connection-actions" });
    const blocked = entry.kind === "plugin" && !verified;
    const buttons: HTMLElement[] = [];
    if (state !== "installed") {
      const label = state === "update" ? tr("update") : tr("install");
      buttons.push(
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-primary",
            disabled: blocked,
            title: blocked ? tr("code") : undefined,
            onClick: () => askFor(listing, false),
          },
          label,
        ),
      );
    }
    const look = lookOf(listing);
    if (look && !inUse(listing))
      buttons.push(
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-primary",
            onClick: () => void queue(entry.id, () => run(look.use, { id: entry.id })),
          },
          tr("use"),
        ),
      );
    const removable =
      look !== undefined ||
      (state !== "available" && entry.kind !== "theme" && entry.kind !== "design-system");
    if (removable)
      buttons.push(
        h(
          "button",
          { type: "button", class: "btn btn-xs btn-outline", onClick: () => askFor(listing, true) },
          tr("remove"),
        ),
      );
    return h("div", { class: "connection-actions" }, buttons);
  };
  /** The question before an install (what it would be allowed, where it comes from) or a remove. */
  const ask = (listing: MarketListing, removing: boolean) => {
    const { added, verified, market } = listing;
    const said = removing ? tr("removeAsk") : added.length ? tr("asks") : tr("nothing");
    const yes = removing ? tr("remove") : added.length ? tr("allow") : tr("install");
    return h(
      "div",
      { class: "market-ask", role: "alertdialog", "aria-label": said },
      h("p", {}, said),
      !removing && added.length
        ? h(
            "ul",
            {},
            added.map((p) => h("li", {}, permissionText(p, language))),
          )
        : null,
      !removing && !verified ? h("p", {}, `${tr("from")} ${hostOf(market)}`) : null,
      h(
        "div",
        { class: "connection-actions" },
        h(
          "button",
          {
            type: "button",
            class: `btn btn-xs ${removing ? "btn-outline" : "btn-primary"}`,
            onClick: () => (removing ? remove(listing) : install(listing)),
          },
          yes,
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-outline",
            onClick: () => {
              asking = undefined;
              draw();
            },
          },
          tr("cancel"),
        ),
      ),
    );
  };
  const card = (listing: MarketListing) => {
    const { entry, verified, state, installed } = listing;
    const status =
      (state === "installed"
        ? `${tr("installed")} ${installed ?? entry.version}`
        : state === "update"
          ? `${tr("installed")} ${installed ?? ""} → ${entry.version}`
          : entry.version) + (inUse(listing) ? ` · ${tr("inUse")}` : "");
    return h(
      "div",
      { class: "settings-row market-entry", "data-entry": entry.id },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, entry.name),
        h(
          "p",
          {},
          h(
            "b",
            { class: `market-badge${verified ? " verified" : ""}` },
            tr(verified ? "verified" : "unverified"),
          ),
          ` · ${entry.publisher} · ${entry.license} · ${status}`,
        ),
        entry.description ? h("p", {}, entry.description) : null,
        asking?.id === entry.id ? ask(listing, asking.remove) : null,
        alerts.has(entry.id)
          ? h("p", { class: "connection-alert", role: "alert" }, alerts.get(entry.id))
          : null,
      ),
      actions(listing),
    );
  };
  function draw() {
    render(el, () => {
      if (entries.length === 0) return [h("p", { class: "settings-footnote" }, tr("empty"))];
      return KINDS.filter((kind) => entries.some((e) => e.entry.kind === kind)).map((kind) =>
        h(
          "section",
          { class: "settings-group", "data-kind": kind },
          h("h2", {}, tr(kind === "design-system" ? "designSystem" : kind)),
          h(
            "div",
            { class: "settings-group-rows" },
            entries.filter((e) => e.entry.kind === kind).map(card),
          ),
        ),
      );
    });
  }
  const ready = load();
  pending = ready;
  return {
    el,
    ready,
    idle: () => pending,
    dispose: () => {
      disposed = true;
      el.remove();
    },
  };
}
