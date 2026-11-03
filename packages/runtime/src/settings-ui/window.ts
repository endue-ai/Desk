/** A runtime-owned system settings window. No plugin or shell is required to open it. */
import type { Preferences } from "../core/preferences";
import { canonical, comboOf } from "../input";
import type { DeskContext } from "../policies/context";
import type { KeysPolicy } from "../policies/keys";
import { h, render } from "../shell/dom";
import { type SettingsLanguage, settingsText } from "./copy";
import { settingsIcon } from "./icons";
import { mountKeyboard } from "./keyboard";
import { description, findSections, SECTIONS, type SettingsSection, settingsPanel } from "./panels";

export interface SettingsWindow {
  open(section?: SettingsSection): void;
  close(): void;
  dispose(): void;
}

export function installSettingsWindow(
  ctx: DeskContext,
  keys: KeysPolicy,
  preferences: Preferences,
  language: SettingsLanguage,
): SettingsWindow {
  const { commands, settings } = ctx.hub;
  const tr = (key: Parameters<typeof settingsText>[1]) => settingsText(language, key);
  let selected: SettingsSection = "general";
  let lastFocus: HTMLElement | null = null;
  let keyboard: ReturnType<typeof mountKeyboard> | undefined;
  const close = () => {
    if (dialog.open) dialog.close();
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
      const visible = findSections(search.value);
      if (!visible.includes(selected) && visible[0]) selected = visible[0];
      draw();
    },
  });
  const nav = h("nav", { class: "settings-nav", "aria-label": tr("title") });
  const sidebar = h(
    "aside",
    { class: "settings-sidebar" },
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
      h("span", { class: "settings-window-dot", "aria-hidden": "true" }),
      h("span", { class: "settings-window-dot", "aria-hidden": "true" }),
    ),
    h("div", { class: "settings-sidebar-title" }, tr("title")),
    h("div", { class: "settings-search" }, settingsIcon("search", 15), search),
    h(
      "div",
      { class: "settings-identity" },
      h("span", { class: "settings-identity-icon" }, settingsIcon("general", 24)),
      h("div", {}, h("strong", {}, "endue Desk"), h("small", {}, tr("device"))),
    ),
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
    keyboard?.dispose();
    keyboard = undefined;
    const sections = findSections(search.value);
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
        });
        return [keyboard.el];
      }
      return [settingsPanel(selected, settings, language, navigate)];
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
      ctx.root.append(dialog);
      dialog.showModal();
    }
    search.focus();
  }
  const saved = () => {
    status.textContent = tr(preferences.state());
    retry.hidden = preferences.state() !== "error";
  };
  const offSave = preferences.onChange(saved);
  saved();
  dialog.addEventListener("close", () => {
    keyboard?.dispose();
    keyboard = undefined;
    dialog.remove();
    lastFocus?.isConnected && lastFocus.focus();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // Modal editing never runs the desk's window/file commands behind the settings window.
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape" || comboOf(event) === canonical("Mod+W", ctx.shortcuts.platform)) {
      event.preventDefault();
      close();
    }
  });
  const offSettings = settings.onChange((changed) => {
    if (
      dialog.open &&
      selected !== "keyboard" &&
      changed.some((key) => key.startsWith("desk.theme.") || key === "desk.notify.dnd")
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
  const offs = [
    offSave,
    offSettings,
    define("desk.settings.open", tr("title"), (args) => {
      const section = (args as { section?: SettingsSection } | undefined)?.section;
      open(section && SECTIONS.includes(section) ? section : undefined);
    }),
    define("desk.settings.keyboard", tr("shortcuts"), () => open("keyboard")),
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
      keyboard?.dispose();
      for (const off of offs) off();
      launcher.remove();
      dialog.remove();
    },
  };
}
