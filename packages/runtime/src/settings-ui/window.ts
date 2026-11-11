/** A runtime-owned system settings window. No plugin or shell is required to open it. */
import type { Preferences } from "../core/preferences";
import { canonical, comboOf } from "../input";
import type { DeskContext } from "../policies/context";
import type { KeysPolicy } from "../policies/keys";
import { h, render } from "../shell/dom";
import { mountAccount } from "./account";
import { mountAccountIdentity } from "./account-identity";
import { type ConnectionsFocus, mountConnections } from "./connections";
import { type SettingsLanguage, settingsText } from "./copy";
import { coreSettings, declaredSearch, pluginSettings } from "./declared";
import { settingsIcon } from "./icons";
import { initFileRow } from "./init-file";
import { mountKeyboard } from "./keyboard";
import { mountMarket } from "./market";
import { description, findSections, SECTIONS, type SettingsSection, settingsPanel } from "./panels";
import { themeSettingsEntry } from "./theme-entry";

export interface SettingsWindow {
  open(section?: SettingsSection): void;
  close(): void;
  dispose(): void;
}

/** The plugin whose window turns plugins on and off. */
const PLUGIN_LIST = "endue.sidebar";
/** The palette's command: its keys leave the window for the palette (#158 finding 19). */
const PALETTE = "desk.palette.open";

export function installSettingsWindow(
  ctx: DeskContext,
  keys: KeysPolicy,
  preferences: Preferences,
  language: SettingsLanguage,
): SettingsWindow {
  const { hub } = ctx;
  const { commands, settings } = hub;
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(language, key);
  const pluginName = (id: string) => hub.plugins.find((p) => p.id === id)?.manifest?.name ?? id;
  // Plugins are turned on and off in the Plugins window; Settings › Plugins leads there.
  const pluginList = () =>
    commands.has("desk.plugins.open") && hub.plugins.some((p) => p.id === PLUGIN_LIST)
      ? () => leaveFor("desk.plugins.open", { plugin: PLUGIN_LIST })
      : undefined;
  let selected: SettingsSection = "general";
  let lastFocus: HTMLElement | null = null;
  /** Close the window for what `command` opens, which takes the focus: none is given back. */
  const leaveFor = (command: string, args?: unknown) => {
    lastFocus = null;
    close();
    void commands.run(command, args).catch(() => {});
  };
  let keyboard: ReturnType<typeof mountKeyboard> | undefined;
  let connections: ReturnType<typeof mountConnections> | undefined;
  let market: ReturnType<typeof mountMarket> | undefined;
  let account: ReturnType<typeof mountAccount> | undefined;
  let focus: ConnectionsFocus = {};
  // Who is signed in to endue, at the top of the sidebar; it leads to the account's settings.
  const identity = mountAccountIdentity(ctx.bridge, language, () => navigate("account"));
  const panels = () => {
    keyboard?.dispose();
    keyboard = undefined;
    connections?.dispose();
    connections = undefined;
    market?.dispose();
    market = undefined;
    account?.dispose();
    account = undefined;
  };
  const close = () => {
    if (!dialog.open) return;
    dialog.close();
    // The focus leaves the window now: when nothing had it before, Chromium keeps it on the hidden
    // search field until the next frame, and a key pressed at once (Esc, then ⌘/) would land there.
    const active = dialog.ownerDocument.activeElement;
    if (active instanceof HTMLElement && dialog.contains(active)) active.blur();
  };
  const launcher = h(
    "button",
    {
      class: "desk-settings-launcher",
      type: "button",
      "aria-label": tr("openHint"),
      title: tr("openHint"),
      onClick: () => open(),
    },
    settingsIcon("general", 21),
  );
  const title = h("h1", { id: "desk-settings-title" });
  const subtitle = h("p", { class: "settings-description" });
  const body = h("div", { class: "settings-content" });
  const status = h("span", { role: "status", "aria-live": "polite" });
  const retry = h(
    "button",
    { type: "button", class: "settings-button", hidden: true, onClick: () => preferences.save() },
    tr("retry"),
  );
  const search = h("input", {
    type: "search",
    placeholder: tr("search"),
    "aria-label": tr("search"),
    onInput: () => {
      const visible = findSections(search.value, declaredSearch(hub));
      if (!visible.includes(selected) && visible[0]) selected = visible[0];
      draw();
    },
  });
  const nav = h("nav", { class: "settings-nav", "aria-label": tr("title") });
  const sidebar = h(
    "aside",
    { class: "settings-sidebar" },
    // The one control the window has: it neither minimizes nor zooms, so it draws no buttons for that.
    h(
      "div",
      { class: "settings-window-controls" },
      h(
        "button",
        {
          class: "settings-window-close",
          type: "button",
          "aria-label": tr("close"),
          title: tr("close"),
          onClick: close,
        },
        settingsIcon("close", 9),
      ),
    ),
    h("div", { class: "settings-sidebar-title" }, tr("title")),
    h("div", { class: "settings-search" }, settingsIcon("search", 15), search),
    identity.el,
    nav,
  );
  const dialog = h(
    "dialog",
    { class: "desk-settings", "aria-labelledby": "desk-settings-title", "aria-modal": "true" },
    h(
      "div",
      { class: "settings-layout" },
      sidebar,
      h(
        "section",
        { class: "settings-detail" },
        h("header", { class: "settings-heading" }, title, subtitle),
        body,
        h("footer", { class: "settings-save-status" }, status, retry),
      ),
    ),
  );
  ctx.root.append(launcher);

  const navigate = (section: SettingsSection) => {
    selected = section;
    search.value = "";
    draw();
  };
  function draw() {
    panels();
    const sections = findSections(search.value, declaredSearch(hub));
    render(nav, () =>
      sections.map((section) =>
        h(
          "button",
          {
            type: "button",
            class: `settings-nav-item${selected === section ? " selected" : ""}`,
            "data-key": `settings-${section}`,
            "aria-current": selected === section ? "page" : undefined,
            onClick: () => navigate(section),
          },
          h("span", { class: `settings-category-icon ${section}` }, settingsIcon(section)),
          h("span", {}, tr(section)),
        ),
      ),
    );
    title.textContent = tr(selected);
    subtitle.textContent = tr(description(selected));
    render(body, () => {
      if (sections.length === 0)
        return [
          h(
            "div",
            { class: "settings-empty" },
            h("h2", {}, tr("noResults")),
            h("p", {}, tr("trySearch")),
          ),
        ];
      if (selected === "keyboard") {
        keyboard = mountKeyboard({
          settings,
          commands,
          contributed: keys.contributed,
          keymap: keys.keymap,
          platform: ctx.shortcuts.platform,
          language,
          plugin: pluginName,
        });
        return [keyboard.el];
      }
      if (selected === "connections") {
        connections = mountConnections({ bridge: ctx.bridge, language, focus });
        return [connections.el];
      }
      if (selected === "market") {
        market = mountMarket({ bridge: ctx.bridge, language, commands, settings });
        return [market.el];
      }
      if (selected === "account") {
        account = mountAccount({ bridge: ctx.bridge, language });
        return [account.el];
      }
      const declared = { hub, preferences, language };
      if (selected === "plugins")
        return [pluginSettings({ ...declared, query: search.value, openPlugins: pluginList() })];
      const general =
        selected === "general" ? [coreSettings(declared), initFileRow(ctx.bridge, language)] : [];
      const appearance =
        selected === "appearance" ? [themeSettingsEntry(commands, close, language)] : [];
      return [settingsPanel(selected, settings, language, navigate, { general, appearance })];
    });
  }
  function open(section?: SettingsSection) {
    if (!dialog.open) lastFocus = ctx.root.ownerDocument.activeElement as HTMLElement | null;
    if (section) {
      selected = section;
      search.value = "";
    }
    draw();
    if (!dialog.open) {
      void identity.refresh();
      ctx.root.append(dialog);
      dialog.showModal();
    }
    // Opened at its shortcuts (⌘/), the caret goes where they are searched.
    if (section === "keyboard" && keyboard) keyboard.focusSearch();
    else search.focus();
  }
  const saved = () => {
    status.textContent = tr(preferences.state());
    retry.hidden = preferences.state() !== "error";
  };
  const offSave = preferences.onChange(saved);
  saved();
  dialog.addEventListener("close", () => {
    // The event comes a task after close(): a key that opened the window again in between (Esc,
    // then ⌘/ at once) keeps it open.
    if (dialog.open) return;
    panels();
    dialog.remove();
    lastFocus?.isConnected && lastFocus.focus();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // Modal editing never runs the desk's window/file commands behind the settings window. The
  // palette's key is the one way out to the rest of the desk: it closes the window and opens it.
  const opensPalette = (combo: string) =>
    commands.has(PALETTE) &&
    keys.keymap
      .resolved()
      .some((b) => b.command === PALETTE && b.chords.length === 1 && b.combo === combo);
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    const combo = comboOf(event);
    if (event.key === "Escape" || combo === canonical("Mod+W", ctx.shortcuts.platform)) {
      event.preventDefault();
      close();
    } else if (opensPalette(combo)) {
      event.preventDefault();
      leaveFor(PALETTE);
    }
  });
  const offSettings = settings.onChange((changed) => {
    if (
      dialog.open &&
      selected !== "keyboard" &&
      // The Market's own row puts a theme in force and goes on (removing it): it redraws itself.
      selected !== "market" &&
      changed.some(
        (key) =>
          key.startsWith("desk.theme.") ||
          key === "desk.notify.dnd" ||
          key === "desk.wallpaper.scene",
      )
    )
      draw();
  });
  const define = (id: string, name: string, run: (args: unknown) => void) =>
    commands.define(id, {
      title: name,
      owner: "desk",
      keywords: ["settings", "preferences", "설정", "keyboard", "shortcuts", "단축키"],
      run,
    });
  // Plugins turned on or off while the window shows what they declare.
  const offPolicy = hub.onPolicy(() => {
    if (dialog.open && (selected === "plugins" || selected === "general")) draw();
  });
  const offs = [
    offSave,
    offSettings,
    offPolicy,
    // desk.keys.quit from the CLI, an agent or Eris: no key reaches the window's own handler.
    keys.onQuit(close),
    define("desk.settings.open", tr("title"), (args) => {
      const section = (args as { section?: SettingsSection } | undefined)?.section;
      open(section && SECTIONS.includes(section) ? section : undefined);
    }),
    define("desk.settings.keyboard", tr("shortcuts"), () => open("keyboard")),
    // Projects, views and connectors lead here to connect a source (ADR 0106).
    define("desk.connectors.open", tr("connections"), (args) => {
      const given = (args ?? {}) as { connector?: unknown; kinds?: unknown };
      focus = {
        ...(typeof given.connector === "string" ? { connector: given.connector } : {}),
        ...(Array.isArray(given.kinds) ? { kinds: given.kinds.map(String) } : {}),
      };
      open("connections");
    }),
    // Every kind the markets offer (ADR 0107).
    define("desk.market.open", tr("market"), () => open("market")),
    define(
      "desk.shell.open-keys",
      language === "ko" ? "설정 · 단축키" : "Settings · keyboard shortcuts",
      () => open("keyboard"),
    ),
  ];
  return {
    open,
    close,
    dispose: () => {
      close();
      panels();
      identity.dispose();
      for (const off of offs) off();
      launcher.remove();
      dialog.remove();
    },
  };
}
