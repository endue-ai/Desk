/**
 * The desk's endue ID in the person's controls (ADR 0084): what the account popover shows, the
 * commands that sign in and out, and Eris's lines while the person finishes signing in in the
 * browser. The brain thinks with the token the core keeps; the runtime only ever sees the state.
 */
import type { AccountStatus } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { type Child, h } from "../shell/dom";
import { accountText } from "./account-copy";

export interface EndueId {
  /** The rows the account popover shows under the person's name. */
  rows(): Child[];
  /** What the identity line says: signed in with endue ID, or on this device. */
  where(): string;
  dispose(): void;
}

/** The page where the code is entered, as people read it: `id.endue.ai/device`. */
export function pageOf(status: AccountStatus): string {
  const uri = status.signIn?.verificationUri ?? "";
  return uri.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function mountEndueId(ctx: ShellCtx, redraw: () => void): EndueId {
  const account = ctx.bridge.account;
  let status: AccountStatus = { state: "signed-out" };
  const tr = (key: Parameters<typeof accountText>[1], vars: Record<string, string> = {}) =>
    accountText(ctx.store.get().lang, key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

  /** A new status, and what Eris says about the change. */
  const changed = (next: AccountStatus, said: boolean) => {
    const before = status.state;
    // signIn's answer and the core's account.changed say the same change: Eris says it once.
    const same = before === next.state && status.signIn?.userCode === next.signIn?.userCode;
    status = next;
    redraw();
    if (!said || same) return;
    if (next.state === "signing-in" && next.signIn)
      ctx.eris.say(tr("enterCode", { code: next.signIn.userCode, page: pageOf(next) }));
    else if (next.state === "signed-in" && before === "signing-in")
      ctx.eris.say(tr("signedInLine"));
    else if (next.problem && before === "signing-in") ctx.eris.say(next.problem);
  };
  const signIn = async () => {
    if (!account) return;
    try {
      changed(await account.signIn(), true);
    } catch (error) {
      ctx.eris.say(error instanceof Error ? error.message : tr("signInFailed"));
    }
  };
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
          run: signIn,
        }),
        ctx.runtime.commands.define("desk.account.sign-out", {
          title: tr("signOut"),
          keywords: ["sign out", "logout", "endue", "로그아웃"],
          owner: "desk",
          run: signOut,
        }),
      ]
    : [];
  void account?.status().then(
    (now) => changed(now, false),
    () => undefined,
  );

  const button = (key: "signIn" | "signOut", run: () => Promise<void>) =>
    h(
      "button",
      {
        class: "btn btn-outline pop-action",
        type: "button",
        "data-key": key === "signIn" ? "account-sign-in" : "account-sign-out",
        onClick: () => void run(),
      },
      tr(key),
    );

  return {
    rows() {
      if (!account) return [];
      const state = {
        "signed-out": tr("signedOut"),
        "signing-in": tr("signingIn"),
        "signed-in": tr("signedIn"),
      }[status.state];
      const code = status.signIn
        ? h(
            "p",
            { class: "account-code" },
            tr("enterCode", { code: status.signIn.userCode, page: pageOf(status) }),
          )
        : null;
      return [
        h(
          "div",
          { class: "pop-row", "data-account": status.state },
          tr("endueId"),
          h("span", { class: "pop-muted" }, state),
        ),
        code,
        status.problem ? h("p", { class: "account-problem" }, status.problem) : null,
        status.state === "signed-in" ? button("signOut", signOut) : button("signIn", signIn),
      ];
    },
    where: () => (status.state === "signed-in" ? tr("withEndue") : tr("local")),
    dispose() {
      for (const off of offs) off();
    },
  };
}
