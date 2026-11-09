/**
 * Settings, endue account (ADR 0130): the signed-in account's own settings on endue, the ones
 * endue.ai's Account and General settings show — the profile, the display language and time zone,
 * and which notifications reach the person's endue.ai inbox — read with account.settings.get and
 * changed with account.settings.update, so endue.ai and the desk always show the same. Signed out,
 * it offers endue ID's sign-in and sign-up and shows the code while the browser waits; it follows
 * account.changed, so a sign-in finished in the browser fills it in. No token reaches the runtime:
 * the picture is account.status's data: URL.
 */
import {
  type AccountSettings,
  type AccountStatus,
  BridgeCallError,
  type BridgeClient,
} from "@endue-ai/bridge";
import { type Child, h, render } from "../shell/dom";
import { problemText } from "../system/account-copy";
import { type AccountCopy, accountText } from "./account-copy";
import { type AccountChange, accountRows } from "./account-rows";
import type { SettingsLanguage } from "./copy";
import { settingsIcon } from "./icons";

const SCOPE = { permission: "account:manage" } as const;

export interface AccountPanel {
  el: HTMLElement;
  /** Resolves once the first status (and, signed in, the settings) is drawn. */
  ready: Promise<void>;
  /** Resolves once every call started so far has been answered and drawn. */
  idle(): Promise<void>;
  dispose(): void;
}

export interface AccountPanelOptions {
  bridge: BridgeClient;
  language: SettingsLanguage;
  /** When the time zones' offsets are taken (tests). */
  now?: Date;
}

/** The page where the code is confirmed, as people read it. */
const pageOf = (uri: string) => uri.replace(/^https?:\/\//, "").replace(/\/$/, "");

export function mountAccount({ bridge, language, now }: AccountPanelOptions): AccountPanel {
  const tr = (key: AccountCopy) => accountText(language, key);
  const el = h("div", { class: "settings-panel-body settings-account", "data-account": "loading" });
  const status = h("p", {
    class: "settings-account-status",
    role: "status",
    "aria-live": "polite",
  });
  let account: AccountStatus = { state: "signed-out" };
  let settings: AccountSettings | undefined;
  /** Why the settings or the account could not be read, for people. */
  let problem: string | undefined;
  let unavailable = false;
  let disposed = false;
  let pending: Promise<unknown>[] = [];
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.push(work);
    return work;
  };

  const messageOf = (error: unknown): string => {
    if (error instanceof BridgeCallError) {
      if (error.code === "offline") return tr("offline");
      if (error.code === "forbidden") return tr("forbidden");
      return error.message.replace(/^[\w.]+: \w+: /, "");
    }
    return error instanceof Error ? error.message : String(error);
  };

  const button = (key: string, label: AccountCopy, run: () => unknown, primary = false) =>
    h(
      "button",
      {
        type: "button",
        class: `btn btn-xs ${primary ? "btn-primary" : "btn-outline"}`,
        "data-key": key,
        onClick: () => void run(),
      },
      tr(label),
    );

  const signedOut = (): Child[] => {
    const code = account.state === "signing-in" ? account.signIn : undefined;
    const line = problemText(language, account);
    return [
      h(
        "div",
        { class: "settings-about settings-account-header" },
        h(
          "span",
          { class: "settings-app-icon", "aria-hidden": "true" },
          settingsIcon("account", 40),
        ),
        h("h2", {}, tr("signedOutTitle")),
        h("p", {}, tr("signedOutHint")),
      ),
      code
        ? h(
            "div",
            { class: "settings-account-code" },
            h("p", {}, tr("confirmCode")),
            h("strong", { "data-key": "account-code" }, code.userCode),
            h("small", {}, pageOf(code.verificationUri)),
          )
        : null,
      line ? h("p", { class: "settings-row-error", role: "status" }, line) : null,
      h(
        "div",
        { class: "settings-account-buttons" },
        code
          ? [
              button(
                "account-open-again",
                "openAgain",
                () => start(code.screen ?? "sign-in"),
                true,
              ),
              button("account-cancel", "cancel", signOut),
            ]
          : [
              button("account-sign-in", "signIn", () => start("sign-in"), true),
              button("account-create", "createAccount", () => start("sign-up")),
            ],
      ),
      status,
    ];
  };

  function draw() {
    if (disposed) return;
    const signedIn = account.state === "signed-in";
    el.dataset.account = unavailable
      ? "unavailable"
      : !signedIn
        ? account.state
        : settings
          ? "ready"
          : problem
            ? "failed"
            : "loading";
    render(el, () => {
      if (unavailable)
        return [h("div", { class: "settings-empty" }, h("p", { role: "status" }, problem))];
      if (!signedIn) return signedOut();
      if (settings)
        return [
          status,
          ...accountRows({
            language,
            settings,
            profile: account.profile,
            save,
            signOut,
            retry: load,
            now,
          }),
        ];
      if (problem)
        return [
          h(
            "div",
            { class: "settings-empty" },
            h("p", { role: "alert" }, problem),
            button("account-retry", "retry", load, true),
          ),
        ];
      return [h("p", { class: "settings-footnote" }, tr("loading"))];
    });
  }

  function load(): Promise<void> {
    return track(
      (async () => {
        problem = undefined;
        draw();
        try {
          settings = await bridge.call("account.settings.get", { scope: SCOPE });
        } catch (error) {
          // The session ended between the status and the settings: show the sign-in.
          if (error instanceof BridgeCallError && error.code === "signed_out")
            account = { state: "signed-out" };
          else problem = messageOf(error);
        }
        draw();
      })(),
    );
  }

  function changed(next: AccountStatus) {
    const was = account.state;
    account = next;
    if (next.state === "signed-in") {
      if (was !== "signed-in" || (!settings && !problem)) void load();
      else draw();
      return;
    }
    settings = undefined;
    problem = undefined;
    draw();
  }

  async function save(change: AccountChange): Promise<boolean> {
    status.textContent = tr("saving");
    return track(
      bridge.call("account.settings.update", { scope: SCOPE, ...change }).then(
        (now) => {
          settings = now;
          status.textContent = tr("saved");
          draw();
          return true;
        },
        (error: unknown) => {
          status.textContent = `${tr("saveFailed")}: ${messageOf(error)}`;
          // A switch or a choice goes back to what endue keeps; a typed profile stays to fix.
          if (change.displayName === undefined && change.avatarUrl === undefined) draw();
          return false;
        },
      ),
    );
  }

  function start(screen: "sign-in" | "sign-up") {
    return track(
      bridge.call("account.signIn", { scope: SCOPE, screen }).then(changed, (error: unknown) => {
        status.textContent = messageOf(error);
      }),
    );
  }

  function signOut() {
    return track(
      bridge.call("account.signOut", { scope: SCOPE }).then(changed, (error: unknown) => {
        status.textContent = messageOf(error);
      }),
    );
  }

  const off = bridge.onEvent((event) => {
    if (event.event === "account.changed") changed(event.data);
  });
  const ready = track(
    bridge.call("account.status", { scope: SCOPE }).then(
      (now) => {
        account = now;
        if (now.state === "signed-in") return load();
        draw();
      },
      (error: unknown) => {
        unavailable = true;
        problem = messageOf(error);
        draw();
      },
    ),
  ).then(() => undefined);
  draw();

  return {
    el,
    ready,
    async idle() {
      while (pending.length) {
        const waiting = pending;
        pending = [];
        await Promise.allSettled(waiting);
      }
    },
    dispose() {
      disposed = true;
      off();
    },
  };
}
