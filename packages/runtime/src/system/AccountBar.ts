/**
 * The account bar: the launcher and the person's avatar, fixed at the bottom left in every desktop
 * and mode. The inbox, Settings and the person's profile are in the avatar's popover
 * (account-menu.ts); this keeps the bar, its two commands and the focus as the popover comes and goes.
 * It stays when the rail is hidden or another plugin holds `role:rail`, so while anything captures
 * the microphone the avatar says so too, and its menu's first row stops it (ADR 0245).
 */
import { runGesture } from "../gesture";
import type { ShellCtx } from "../shell/context";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { micLabel, stopEveryCapture, watchMic } from "../shell/mic";
import { initial } from "../shell/state";
import { accountText } from "./account-copy";
import { type AccountView, accountPopover, viewOf, walkButtons } from "./account-menu";
import { mountEndueId } from "./endue-id";

/** The command the launcher plugin answers. */
const LAUNCHER = "endue.launcher.open";

export function mountAccountBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const bar = h("nav", {
    class: "account-bar float-bar",
    // Each control closes or switches the popover on click. Do not dismiss on pointerdown:
    // replacing its focused button before pointerup would lose that click.
    onPointerdown: (event: PointerEvent) => event.stopPropagation(),
  });
  const slot = h("div", {
    class: "account-popover-slot",
    // Escape closes the popover (draw gives the focus back to the avatar); the arrows, Home and
    // End walk its buttons. Tab is the browser's.
    onKeydown: (event: KeyboardEvent) => {
      const popover = slot.querySelector<HTMLElement>(".account-popover");
      if (!popover || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") ctx.store.set({ popover: null });
      else if (!walkButtons(popover, event.key)) return;
      event.preventDefault();
      event.stopPropagation();
    },
  });
  root.append(bar, slot);
  const face = () => bar.querySelector<HTMLElement>(".account-profile");
  let name = "";
  let generation = 0;
  /** The view the popover showed when it was last drawn. */
  let last: AccountView | null = null;
  const tr = (key: Parameters<typeof accountText>[1]) => accountText(ctx.store.get().lang, key);
  // A button whose command fails says why (gesture.ts).
  const run = (command: string) => void runGesture(ctx.runtime, command);
  // The endue ID the brain thinks with (ADR 0089), under the person's name.
  const endue = mountEndueId(ctx, () => draw());
  const readUser = async () => {
    const current = ++generation;
    try {
      const user = await ctx.bridge.user?.info();
      if (current !== generation) return;
      name = user?.name?.trim() ?? "";
      draw();
    } catch {
      // The local user remains usable when the stored first-run information cannot be read.
    }
  };
  /** The person's picture from endue (a data: URL only), else their initial, else the user icon. */
  const avatar = (shown: string) => {
    const picture = endue.profile()?.avatarUrl;
    return h(
      "span",
      { class: "account-avatar", "aria-hidden": "true" },
      picture?.startsWith("data:image/")
        ? h("img", { class: "account-picture", src: picture, alt: "" })
        : shown
          ? initial(shown)
          : icon("user", 18),
    );
  };
  const mic = watchMic(ctx, () => draw());
  const draw = () => {
    const s = ctx.store.get();
    const view = viewOf(s);
    const count = s.attention.length;
    const captures = mic.captures();
    const listening = captures.length > 0 ? micLabel(ctx, captures) : undefined;
    const said = count ? `${tr("account")} · ${tr("inbox")} · ${count}` : tr("account");
    // Signed in, the account's name stands for the person; the first-run name otherwise.
    const shownName = endue.profile()?.displayName?.trim() || name;
    const userName = shownName || tr("localUser");
    // Whether the popover had the focus before it is drawn anew.
    const held = slot.contains(root.ownerDocument.activeElement);
    bar.setAttribute("aria-label", tr("controls"));
    render(bar, () => [
      // The launcher's grid of every plugin (endue.launcher, ADR 0217): the one place on screen
      // that opens a plugin, since the desk has no dock.
      h(
        "button",
        {
          class: "icon-button launcher-button",
          type: "button",
          "data-key": "launcher",
          "aria-label": tr("launcher"),
          title: tr("launcher"),
          onClick: () => {
            ctx.store.set({ popover: null });
            run(LAUNCHER);
          },
        },
        icon("grid"),
      ),
      // The person. While the inbox holds something, or the microphone is on, the avatar shows a
      // dot, its own ::after on [data-attention] (system.css), and its name says why.
      h(
        "button",
        {
          class: `icon-button account-profile${view ? " is-open" : ""}`,
          type: "button",
          "data-key": "account-profile",
          "data-attention": count || (listening ? "mic" : undefined),
          "data-mic": listening ? "on" : undefined,
          "aria-label": listening ? `${said} · ${listening}` : said,
          "aria-expanded": String(view !== null),
          title: `${tr("account")} · ${userName}`,
          onClick: () => run("desk.account.open"),
        },
        avatar(shownName),
      ),
    ]);
    render(slot, () =>
      view
        ? [
            accountPopover(
              {
                ctx,
                tr,
                run,
                face: () => avatar(shownName),
                userName,
                endue,
                mic: listening
                  ? { label: listening, stop: () => void stopEveryCapture(ctx, captures) }
                  : undefined,
                // Settings goes back to what had the focus when it opened: the avatar.
                settings: () => {
                  ctx.store.set({ popover: null });
                  face()?.focus();
                  run("desk.settings.open");
                },
              },
              s,
              view,
            ),
          ]
        : [],
    );
    // The focus follows the popover. Opened, the menu's first row has it; the inbox's list, or a
    // popover whose focused button a redraw took away, holds it itself, so Escape and the arrows
    // still reach it. Closed with the focus inside and nothing else opened, the avatar has it back.
    const popover = slot.querySelector<HTMLElement>(".account-popover");
    if (popover && view !== last) {
      const first = view === "account" ? popover.querySelector<HTMLElement>("button") : null;
      (first ?? popover).focus();
    } else if (popover && held && !slot.contains(root.ownerDocument.activeElement)) popover.focus();
    else if (!popover && held && s.popover === null) face()?.focus();
    last = view;
  };
  const commands = [
    ctx.runtime.commands.define("desk.inbox.open", {
      title: () => tr("inbox"),
      keywords: ["inbox", "notifications", "인박스", "알림"],
      owner: "desk",
      run: () =>
        ctx.store.set((s) => ({ popover: s.popover === "attention" ? null : "attention" })),
    }),
    ctx.runtime.commands.define("desk.account.open", {
      title: () => tr("account"),
      keywords: ["account", "user", "사용자", "계정"],
      owner: "desk",
      run: () => {
        ctx.store.set((s) => ({ popover: s.popover === "account" ? null : "account" }));
        if (ctx.store.get().popover === "account") void readUser();
      },
    }),
  ];
  draw();
  void readUser();
  const off = ctx.store.watch(
    (s) => [s.attention, s.popover, s.lang, s.modeId, s.modes, s.spaceId, s.spaces],
    draw,
  );
  return () => {
    generation++;
    off();
    mic.dispose();
    endue.dispose();
    for (const undo of commands) undo();
    bar.remove();
    slot.remove();
  };
}
