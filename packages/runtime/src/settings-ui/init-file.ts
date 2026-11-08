/**
 * General's "Open init.yaml": the file init.get names, shown in the file manager through shell.open
 * as `desk.files.reveal` shows a file (ADR 0047). The first reveal may ask for shell:open on it.
 */
import type { BridgeClient } from "@endue-ai/bridge";
import { h } from "../shell/dom";
import { type SettingsCopy, type SettingsLanguage, settingsText } from "./copy";

/** Where the app reads init.yaml when init.get names no file (apps/desk's INIT_FILE under ~). */
export const INIT_FILE = "~/.desk/init.yaml";

/** Show init.yaml in the file manager; resolves with the path shown. */
export async function revealInit(bridge: BridgeClient): Promise<string> {
  const { file } = await bridge.call("init.get", {});
  const target = file ?? INIT_FILE;
  const scope = { permission: "shell:open" as const, paths: [target] };
  await bridge.call("shell.open", { target, reveal: true, scope });
  return target;
}

/** The settings file group General shows: init.yaml, what it is, and the button that reveals it. */
export function initFileRow(bridge: BridgeClient, language: SettingsLanguage): HTMLElement {
  const tr = (key: SettingsCopy) => settingsText(language, key);
  const alert = h("p", { class: "settings-row-error", role: "alert", hidden: true });
  const reveal = () => {
    alert.hidden = true;
    revealInit(bridge).catch((error: unknown) => {
      alert.textContent = error instanceof Error ? error.message : String(error);
      alert.hidden = false;
    });
  };
  return h(
    "section",
    { class: "settings-group" },
    h("h3", {}, tr("initFile")),
    h(
      "div",
      { class: "settings-group-rows" },
      h(
        "div",
        { class: "settings-row" },
        h(
          "div",
          { class: "settings-row-label" },
          h("span", {}, "init.yaml"),
          h("p", {}, tr("initHint")),
          alert,
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-outline",
            "data-key": "open-init",
            onClick: reveal,
          },
          tr("openInit"),
        ),
      ),
    ),
  );
}
