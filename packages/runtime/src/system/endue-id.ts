/**
 * The desk's endue ID in the person's controls (ADR 0089, ADR 0111): what the account popover shows,
 * the commands that sign in, create an account and sign out, and Eris's lines while the person
 * finishes in the browser. Signing in happens on endue ID's own pages at auth.endue.ai, the ones the
 * endue.ai web uses; the popover shows the code to confirm there, opens the page again on request
 * and words every failure with a way to try again. The runtime only ever sees the state and the
 * profile; the core keeps the session.
 */
import type { AccountStatus } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { type Child, h } from "../shell/dom";
import { type AccountKey, accountText, problemText } from "./account-copy";

type Screen = "sign-in" | "sign-up";

export interface EndueId {
  /** The rows the account popover shows under the person's name. */
  rows(): Child[];
  /** What the identity line says: the account's email, or on this device. */
  where(): string;
  /** The signed-in person: name, email and picture (a data: URL) from endue. */
  profile(): AccountStatus["profile"];
  dispose(): void;
}

/** The page where the code is confirmed, as people read it: `auth.endue.ai/realms/endue/device`. */
export function pageOf(status: AccountStatus): string {
  const uri = status.signIn?.verificationUri ?? "";
  return uri.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function mountEndueId(ctx: ShellCtx, redraw: () => void): EndueId {
  const account = ctx.bridge.account;
  let status: AccountStatus = { state: "signed-out" };
  /** The page the last sign-in started on, which Try again starts on too. */
  let screen: Screen = "sign-in";
  const lang = () => ctx.store.get().lang;
  const tr = (key: AccountKey, vars: Record<string, string> = {}) =>
    accountText(lang(), key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

  /** Changes heard so far: the first status answer must not undo a newer one. */
  let heard = 0;
  /** A new status, and what Eris says about the change: once, however many times it arrives. */
  const changed = (next: AccountStatus, said: boolean) => {
    const before = status;
    heard += 1;
    status = next;
    redraw();
    if (!said) return;
    if (next.state === "signing-in") {
      if (before.state !== "signing-in" && next.signIn)
        ctx.eris.say(tr("enterCode", { code: next.signIn.userCode }));
      return;
    }
    if (next.state === "signed-in" && before.state === "signing-in") {
      ctx.eris.say(tr("signedInLine"));
      return;
    }
    const ended = before.state === "signing-in" || next.reason === "session-expired";
    const line = problemText(lang(), next);
    if (line && ended && next.reason !== before.reason) ctx.eris.say(line);
  };
  const signIn = async (which: Screen = "sign-in") => {
    if (!account) return;
    screen = which;
    try {
      changed(await account.signIn(which), true);
    } catch (error) {
      ctx.eris.say(error instanceof Error ? error.message : tr("signInFailed"));
    }
  };
  // Under way, signing in again keeps the code and opens its page again.
  const openAgain = () => signIn(status.signIn?.screen ?? screen);
  const signOut = async () => {
    if (!account) return;
    changed(await account.signOut().catch(() => status), false);
  };

  const offs = account
    ? [
        account.onChange((next) => changed(next, true)),
        ctx.runtime.commands.define("desk.account.sign-in", {
          title: tr("signIn"),
          keywords: ["sign in", "login", "endue", "로그인"],
          owner: "desk",
          run: () => signIn("sign-in"),
        }),
        ctx.runtime.commands.define("desk.account.create", {
          title: tr("createAccount"),
          keywords: ["sign up", "create account", "register", "endue", "회원가입", "가입"],
          owner: "desk",
          run: () => signIn("sign-up"),
        }),
        ctx.runtime.commands.define("desk.account.sign-out", {
          title: tr("signOut"),
          keywords: ["sign out", "logout", "endue", "로그아웃"],
          owner: "desk",
          run: signOut,
        }),
      ]
    : [];
  const asked = heard;
  void account?.status().then(
    (now) => heard === asked && changed(now, false),
    () => undefined,
  );

  const button = (key: string, label: AccountKey, run: () => Promise<void>, primary = false) =>
    h(
      "button",
      {
        class: `btn ${primary ? "btn-primary" : "btn-outline"}`,
        type: "button",
        "data-key": key,
        onClick: () => void run(),
      },
      tr(label),
    );

  const actions = (): Child => {
    const { state, reason } = status;
    const buttons =
      state === "signed-in"
        ? [button("account-sign-out", "signOut", signOut)]
        : state === "signing-in"
          ? [
              button("account-open-again", "openAgain", openAgain, true),
              button("account-cancel", "cancel", signOut),
            ]
          : reason && reason !== "session-expired"
            ? [
                button("account-retry", "retry", () => signIn(screen), true),
                screen === "sign-up"
                  ? button("account-sign-in", "signIn", () => signIn("sign-in"))
                  : button("account-create", "createAccount", () => signIn("sign-up")),
              ]
            : [
                button("account-sign-in", "signIn", () => signIn("sign-in"), true),
                button("account-create", "createAccount", () => signIn("sign-up")),
              ];
    return h("div", { class: "account-actions" }, buttons);
  };

  const waiting = (signIn: NonNullable<AccountStatus["signIn"]>): Child =>
    h(
      "div",
      { class: "account-code", "data-screen": signIn.screen ?? "sign-in" },
      h("p", {}, tr("confirmCode")),
      h("strong", { class: "account-user-code", "data-key": "account-code" }, signIn.userCode),
      h("small", { class: "pop-muted" }, pageOf(status)),
      signIn.screen === "sign-up" ? h("p", { class: "pop-muted" }, tr("signUpHint")) : null,
    );

  return {
    rows() {
      if (!account) return [];
      const label = {
        "signed-out": tr("signedOut"),
        "signing-in": tr("signingIn"),
        "signed-in": tr("signedIn"),
      }[status.state];
      const problem = problemText(lang(), status);
      const notice = status.state !== "signed-out";
      return [
        h(
          "div",
          { class: "pop-row", "data-account": status.state },
          tr("endueId"),
          h("span", { class: "pop-muted" }, label),
        ),
        status.state === "signing-in" && status.signIn ? waiting(status.signIn) : null,
        problem
          ? h(
              "p",
              {
                class: notice ? "account-problem is-notice" : "account-problem",
                role: "status",
                "data-reason": status.reason ?? "unknown",
              },
              problem,
            )
          : null,
        actions(),
      ];
    },
    where: () =>
      status.state === "signed-in" ? (status.profile?.email ?? tr("withEndue")) : tr("local"),
    profile: () => (status.state === "signed-in" ? status.profile : undefined),
    dispose() {
      for (const off of offs) off();
    },
  };
}
