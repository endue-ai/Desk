/**
 * Settings, Market (ADR 0107): every kind the markets offer (market.list), in groups by kind, each
 * with its publisher, licence, version and whether it comes from the endue index. Install always
 * asks first, saying what it would be allowed (or that it asks for nothing) and where an entry that
 * is not verified comes from, before plugin.install runs; code that is not verified does not install.
 * What the market installed can be removed (plugin.remove), after a question too.
 */
import {
  BridgeCallError,
  type BridgeClient,
  type MarketListing,
  type Permission,
} from "@endue-ai/bridge";
import { permissionWords } from "../describe/words";
import { h, render } from "../shell/dom";
import type { SettingsLanguage } from "./copy";

const SCOPE = { permission: "plugin:manage" } as const;
type Kind = MarketListing["entry"]["kind"];
const KINDS: Kind[] = ["view", "pack", "plugin", "theme", "design-system"];

const COPY = {
  view: ["뷰", "Views"],
  pack: ["팩", "Packs"],
  plugin: ["플러그인", "Plugins"],
  theme: ["테마", "Themes"],
  "design-system": ["디자인 시스템", "Design systems"],
  verified: ["확인됨", "Verified"],
  unverified: ["확인되지 않음", "Not verified"],
  install: ["설치", "Install"],
  update: ["업데이트", "Update"],
  remove: ["제거", "Remove"],
  installed: ["설치됨", "Installed"],
  asks: ["설치하면 다음을 허락합니다:", "Installing it allows:"],
  nothing: ["허락할 권한이 없습니다.", "It asks for no permissions."],
  from: ["확인되지 않은 마켓에서 옵니다:", "Not verified: it comes from"],
  allow: ["허락하고 설치", "Allow and install"],
  removeAsk: [
    "제거할까요? 여기서 다시 설치할 수 있습니다.",
    "Remove it? You can install it again here.",
  ],
  cancel: ["취소", "Cancel"],
  empty: ["마켓에 아무것도 없습니다.", "The markets offer nothing yet."],
  code: ["코드는 endue 마켓에서만 설치합니다.", "Code installs from the endue market only."],
} as const;
type Copy = keyof typeof COPY;

/** One permission in words a person reads before allowing it. */
export function permissionText(permission: Permission, language: SettingsLanguage): string {
  const ko = language === "ko";
  const p = permission as Permission & Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.join(", ") : "");
  switch (p.permission) {
    case "data:read":
      return ko
        ? `${list(p.kinds) || "모든"} 항목 읽기`
        : `Read your ${list(p.kinds) ? `${list(p.kinds)}s` : "items"}`;
    case "net:fetch":
      return ko ? `${list(p.hosts)} 에 접속` : `Reach ${list(p.hosts)}`;
    case "fs:read":
      return ko ? `파일 읽기: ${list(p.paths)}` : `Read files: ${list(p.paths)}`;
    case "fs:write":
      return ko ? `파일 쓰기: ${list(p.paths)}` : `Write files: ${list(p.paths)}`;
    default: {
      if (ko) return p.permission;
      const words = permissionWords(permission);
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }
}

/** Where a market index is, by its host. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function mountMarket(options: { bridge: BridgeClient; language: SettingsLanguage }): {
  el: HTMLElement;
  ready: Promise<void>;
  idle(): Promise<void>;
  dispose(): void;
} {
  const { bridge, language } = options;
  const tr = (key: Copy) => COPY[key][language === "ko" ? 0 : 1];
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
    void queue(id, () => bridge.call("plugin.remove", { plugin: id, scope: SCOPE }));
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
    const removable =
      state !== "available" && entry.kind !== "theme" && entry.kind !== "design-system";
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
      state === "installed"
        ? `${tr("installed")} ${installed ?? entry.version}`
        : state === "update"
          ? `${tr("installed")} ${installed ?? ""} → ${entry.version}`
          : entry.version;
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
          h("h2", {}, tr(kind)),
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
