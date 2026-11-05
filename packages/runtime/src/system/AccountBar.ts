/** Inbox, settings and the person's profile: fixed at the bottom left in every desktop and mode. */
import type { ShellCtx } from "../shell/context";
import { h, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { initial } from "../shell/state";
import { accountText } from "./account-copy";
import { mountEndueId } from "./endue-id";

export function mountAccountBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const bar = h("nav", {
    class: "account-bar float-bar",
    // Each control closes or switches the popover on click. Do not dismiss on pointerdown:
    // replacing its focused button before pointerup would lose that click.
    onPointerdown: (event: PointerEvent) => event.stopPropagation(),
  });
  const slot = h("div", { class: "account-popover-slot" });
  root.append(bar, slot);
  let name = "";
  let generation = 0;
  const tr = (key: Parameters<typeof accountText>[1]) => accountText(ctx.store.get().lang, key);
  const run = (command: string) => void ctx.runtime.commands.run(command).catch(() => {});
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
  const draw = () => {
    const s = ctx.store.get();
    const inbox = `${tr("inbox")} · ${s.attention.length}`;
    const userName = name || tr("localUser");
    bar.setAttribute("aria-label", tr("controls"));
    render(bar, () => [
      h(
        "button",
        {
          class: `icon-button inbox-button${s.popover === "attention" ? " is-open" : ""}`,
          type: "button",
          "data-key": "inbox",
          "aria-label": inbox,
          "aria-expanded": String(s.popover === "attention"),
          title: inbox,
          onClick: () => run("desk.inbox.open"),
        },
        icon("inbox"),
        s.attention.length ? h("span", { class: "badge" }, s.attention.length) : null,
      ),
      h(
        "button",
        {
          class: "icon-button account-settings-button",
          type: "button",
          "data-key": "account-settings",
          "aria-label": tr("settings"),
          title: tr("settings"),
          onClick: () => {
            ctx.store.set({ popover: null });
            run("desk.settings.open");
          },
        },
        icon("settings"),
      ),
      h(
        "button",
        {
          class: `icon-button account-profile${s.popover === "account" ? " is-open" : ""}`,
          type: "button",
          "data-key": "account-profile",
          "aria-label": tr("account"),
          "aria-expanded": String(s.popover === "account"),
          title: `${tr("account")} · ${userName}`,
          onClick: () => run("desk.account.open"),
        },
        h(
          "span",
          { class: "account-avatar", "aria-hidden": "true" },
          name ? initial(name) : icon("user", 18),
        ),
      ),
    ]);
    render(slot, () => {
      if (s.popover !== "attention" && s.popover !== "account") return [];
      const isInbox = s.popover === "attention";
      const profile = s.modes.find((mode) => mode.manifest.id === s.modeId)?.manifest.name;
      const space = s.spaces.find((entry) => entry.id === s.spaceId)?.name;
      return [
        h(
          "section",
          {
            class: "popover account-popover",
            role: "dialog",
            "aria-label": tr(isInbox ? "inbox" : "account"),
            "data-popover": s.popover,
          },
          h("div", { class: "pop-title" }, tr(isInbox ? "inbox" : "account")),
          isInbox
            ? s.attention.length
              ? s.attention.map((item) =>
                  h(
                    "div",
                    { class: "inbox-item" },
                    h(
                      "div",
                      { class: "pop-row" },
                      h("span", { class: "dot dot-attention" }),
                      h("span", {}, item.text),
                    ),
                    item.action
                      ? h(
                          "button",
                          {
                            class: "btn btn-outline pop-action",
                            type: "button",
                            "data-key": `attention-${item.id}`,
                            onClick: () => item.action && run(item.action.command),
                          },
                          item.action.label,
                        )
                      : null,
                  ),
                )
              : h("p", { class: "account-empty" }, ctx.tr("empty"))
            : [
                h(
                  "div",
                  { class: "account-identity" },
                  h(
                    "span",
                    { class: "account-avatar", "aria-hidden": "true" },
                    name ? initial(name) : icon("user", 18),
                  ),
                  h("div", {}, h("strong", {}, userName), h("small", {}, endue.where())),
                ),
                ...endue.rows(),
                profile
                  ? h(
                      "div",
                      { class: "pop-row" },
                      tr("profile"),
                      h("span", { class: "pop-muted" }, profile),
                    )
                  : null,
                space
                  ? h(
                      "div",
                      { class: "pop-row" },
                      tr("space"),
                      h("span", { class: "pop-muted" }, space),
                    )
                  : null,
              ],
        ),
      ];
    });
  };
  const commands = [
    ctx.runtime.commands.define("desk.inbox.open", {
      title: tr("inbox"),
      keywords: ["inbox", "notifications", "인박스", "알림"],
      owner: "desk",
      run: () =>
        ctx.store.set((s) => ({ popover: s.popover === "attention" ? null : "attention" })),
    }),
    ctx.runtime.commands.define("desk.account.open", {
      title: tr("account"),
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
    endue.dispose();
    for (const undo of commands) undo();
    bar.remove();
    slot.remove();
  };
}
