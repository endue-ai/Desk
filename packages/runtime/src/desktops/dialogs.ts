/**
 * The desktops' two dialogs (ADR 0117): rename one, and remove one after asking what becomes of its
 * windows (moved to its neighbour, or closed). An empty desktop is removed without asking.
 */
import type { DesktopRef } from "../modes/types";
import { desktopId, desktopsOf, layoutOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { containModal } from "../shell/modal";
import { nameOf, remove, rename, tx } from "./actions";
import { NAME_LIMIT, neighbourOf } from "./model";

export interface Dialogs {
  rename(desktop: DesktopRef): void;
  remove(desktop: DesktopRef): void;
  dispose(): void;
}

export function mountDialogs(root: HTMLElement, ctx: ShellCtx): Dialogs {
  let current: { el: HTMLElement; release: () => void } | undefined;
  const close = () => {
    const was = current;
    current = undefined;
    was?.el.remove();
    was?.release();
  };
  const fallback = () =>
    root.querySelector<HTMLElement>(".desktops .desktop-button.is-active") ?? root;

  const open = (form: HTMLFormElement, focus: HTMLElement) => {
    close();
    const el = h(
      "div",
      {
        class: "scrim desktops-dialog",
        onClick: (e: Event) => e.target === e.currentTarget && close(),
      },
      form,
    );
    root.append(el);
    current = { el, release: containModal(form, close, fallback()) };
    focus.focus();
  };

  const dialog = (titleId: string, title: string, hint: string | null, submit: () => void) =>
    h(
      "form",
      {
        class: "dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        onSubmit: (event: Event) => {
          event.preventDefault();
          submit();
        },
      },
      h("h2", { class: "dialog-title", id: titleId }, title),
      hint ? h("p", { class: "dialog-hint" }, hint) : null,
    );

  return {
    rename(desktop) {
      const s = ctx.store.get();
      const id = desktopId(s, desktop);
      const input = h("input", {
        class: "input",
        id: "desktop-name",
        "data-key": "desktop-name",
        autocomplete: "off",
        maxlength: NAME_LIMIT,
        value: nameOf(s, id),
      });
      const form = dialog("desktop-rename-title", tx(ctx, "renameTitle"), null, () => {
        if (input.value.trim()) rename(ctx, id, input.value);
        close();
      });
      form.append(
        h("label", { class: "field-label", for: "desktop-name" }, ctx.tr("name")),
        input,
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { class: "btn btn-ghost", type: "button", onClick: close }, ctx.tr("cancel")),
          h("button", { class: "btn btn-primary", type: "submit" }, ctx.tr("save")),
        ),
      );
      open(form, input);
      input.select();
    },

    remove(desktop) {
      const s = ctx.store.get();
      const list = desktopsOf(s);
      const id = desktopId(s, desktop);
      const into = neighbourOf(list, id);
      if (list.length <= 1 || !into) return;
      const count = layoutOf(s, id).surfaces.length;
      if (count === 0) {
        remove(ctx, id, "close");
        return;
      }
      const name = nameOf(s, id);
      const moveButton = h(
        "button",
        { class: "btn btn-primary", type: "submit", "data-key": "desktop-remove-move" },
        tx(ctx, "moveWindows", { name: nameOf(s, into) }),
      );
      const form = dialog(
        "desktop-remove-title",
        tx(ctx, "removeTitle", { name }),
        tx(ctx, "removeHint", { n: count }),
        () => {
          close();
          remove(ctx, id, "move");
        },
      );
      form.append(
        h(
          "div",
          { class: "dialog-actions desktops-remove-actions" },
          h("button", { class: "btn btn-ghost", type: "button", onClick: close }, ctx.tr("cancel")),
          h(
            "button",
            {
              class: "btn btn-danger",
              type: "button",
              "data-key": "desktop-remove-close",
              onClick: () => {
                close();
                remove(ctx, id, "close");
              },
            },
            tx(ctx, "closeWindows"),
          ),
          moveButton,
        ),
      );
      open(form, moveButton);
    },

    dispose: close,
  };
}
