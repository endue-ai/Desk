/**
 * The identity at the top of the settings sidebar (ADR 0130): who is signed in to endue — their
 * picture, name and email — or an invitation to sign in, and either way the way to Settings, endue
 * account. A desk without an endue ID keeps the plain "endue Desk · Settings for this device".
 */
import type { AccountStatus, BridgeClient } from "@endue-ai/bridge";
import { h, render } from "../shell/dom";
import { accountText } from "./account-copy";
import { accountAvatar } from "./account-rows";
import { type SettingsLanguage, settingsText } from "./copy";
import { settingsIcon } from "./icons";

const SCOPE = { permission: "account:manage" } as const;

export interface AccountIdentity {
  el: HTMLElement;
  /** Ask the core again (the window opens). */
  refresh(): Promise<void>;
  dispose(): void;
}

export function mountAccountIdentity(
  bridge: BridgeClient,
  language: SettingsLanguage,
  open: () => void,
): AccountIdentity {
  const el = h("div", { class: "settings-identity" });
  let status: AccountStatus | undefined;
  const draw = () =>
    render(el, () => {
      if (!status)
        return [
          h("span", { class: "settings-identity-icon" }, settingsIcon("general", 24)),
          h(
            "div",
            {},
            h("strong", {}, "endue Desk"),
            h("small", {}, settingsText(language, "device")),
          ),
        ];
      const profile = status.state === "signed-in" ? status.profile : undefined;
      const name = profile?.displayName ?? profile?.email ?? accountText(language, "title");
      const line =
        status.state === "signed-in"
          ? (profile?.email ?? accountText(language, "title"))
          : accountText(language, "sidebarHint");
      return [
        h(
          "button",
          {
            type: "button",
            class: "menu-item settings-identity-button",
            "data-key": "settings-identity",
            "data-account": status.state,
            onClick: open,
          },
          status.state === "signed-in"
            ? accountAvatar(profile, name, 42)
            : h("span", { class: "settings-identity-icon" }, settingsIcon("account", 24)),
          h(
            "div",
            {},
            h("strong", {}, status.state === "signed-in" ? name : accountText(language, "signIn")),
            h("small", {}, line),
          ),
        ),
      ];
    });
  const refresh = () =>
    bridge.call("account.status", { scope: SCOPE }).then(
      (now) => {
        status = now;
        draw();
      },
      // No endue ID on this desk: the plain identity stays.
      () => undefined,
    );
  const off = bridge.onEvent((event) => {
    if (event.event !== "account.changed") return;
    status = event.data;
    draw();
  });
  // The status is asked for when the window opens, not when the desk starts: no call at start.
  draw();
  return { el, refresh, dispose: off };
}
