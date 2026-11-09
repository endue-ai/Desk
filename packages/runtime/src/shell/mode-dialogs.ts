/**
 * The profile switcher's dialogs: a name for a new profile (the desk as it is), a new name for one,
 * and deleting one, or restoring a plugin's profile the person saved over. Save stays off until there
 * is a name. One dialog at a time; Esc or a click on the scrim closes it.
 */
import { saveAsNewMode } from "./actions";
import type { ShellCtx } from "./context";
import { h, listen } from "./dom";
import { containModal } from "./modal";
import { homeFor, MODE_NAME_LIMIT, modeName, originOf, removeMode, renameMode } from "./mode-edit";

export interface ModeDialogs {
  /** "+" and "Save as new profile": what store.dialog "new-mode" opens. */
  create(): void;
  rename(id: string): void;
  /** Delete the person's own profile, or restore a plugin's they saved over; nothing for a plugin's. */
  remove(id: string): void;
  close(): void;
}

export function mountModeDialogs(
  slot: HTMLElement,
  ctx: ShellCtx,
  fallback: () => HTMLElement,
): ModeDialogs {
  let current: { el: HTMLElement; release: () => void; offs: Array<() => void> } | undefined;
  /** Take the open dialog away, giving focus back to whoever had it. */
  const drop = () => {
    const was = current;
    current = undefined;
    was?.el.remove();
    for (const off of was?.offs ?? []) off();
    was?.release();
  };
  const close = () => {
    drop();
    if (ctx.store.get().dialog === "new-mode") ctx.store.set({ dialog: null });
  };
  const open = (form: HTMLFormElement, focus: HTMLElement, offs: Array<() => void> = []) => {
    drop();
    const el = h(
      "div",
      { class: "scrim", onClick: (e: Event) => e.target === e.currentTarget && close() },
      form,
    );
    slot.append(el);
    current = { el, offs, release: containModal(form, close, fallback()) };
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
  const cancel = () =>
    h("button", { class: "btn btn-ghost", type: "button", onClick: close }, ctx.tr("cancel"));

  /** A dialog that asks for a name: Save is off while the name is empty. */
  const named = (
    key: string,
    title: string,
    hint: string | null,
    value: string,
    submit: (name: string) => void,
  ) => {
    const input = h("input", {
      class: "input",
      id: key,
      "data-key": key,
      autocomplete: "off",
      maxlength: MODE_NAME_LIMIT,
      value,
    });
    const save = h(
      "button",
      { class: "btn btn-primary", type: "submit", disabled: !modeName(value) },
      ctx.tr("save"),
    );
    const form = dialog(`${key}-title`, title, hint, () => {
      const name = modeName(input.value);
      if (name) submit(name);
    });
    form.append(
      h("label", { class: "field-label", for: key }, ctx.tr("name")),
      input,
      h("div", { class: "dialog-actions" }, cancel(), save),
    );
    const typed = listen(input, "input", () => {
      save.disabled = !modeName(input.value);
    });
    open(form, input, [typed]);
    return input;
  };

  return {
    create() {
      named("new-mode-name", ctx.tr("saveNowTitle"), ctx.tr("saveNowHint"), "", (name) =>
        saveAsNewMode(ctx, name),
      );
    },

    rename(id) {
      const mode = ctx.store.get().modes.find((m) => m.manifest.id === id);
      if (!mode) return;
      const input = named(
        "rename-mode-name",
        ctx.tr("renameModeTitle"),
        null,
        mode.manifest.name,
        (name) => {
          close();
          void renameMode(ctx, id, name);
        },
      );
      input.select();
    },

    remove(id) {
      const origin = originOf(ctx, id);
      const s = ctx.store.get();
      const mode = s.modes.find((m) => m.manifest.id === id);
      if (origin === "plugin" || !mode) return;
      const restore = origin === "changed";
      const name = mode.manifest.name;
      const home = homeFor(s.modes, id);
      const hint = restore
        ? ctx.tr("restoreModeHint")
        : id === s.modeId && home
          ? ctx.tr("removeModeHint", { home: home.manifest.name })
          : null;
      const form = dialog(
        "mode-remove-title",
        ctx.tr(restore ? "restoreModeTitle" : "removeModeTitle", { name }),
        hint,
        () => {
          close();
          void removeMode(ctx, id);
        },
      );
      // Cancel holds the focus: Enter never deletes by accident.
      const keep = cancel();
      form.append(
        h(
          "div",
          { class: "dialog-actions" },
          keep,
          h(
            "button",
            {
              class: `btn ${restore ? "btn-primary" : "btn-danger"}`,
              type: "submit",
              "data-key": "mode-remove-confirm",
            },
            ctx.tr(restore ? "restoreModeConfirm" : "removeModeConfirm"),
          ),
        ),
      );
      open(form, keep);
    },

    close,
  };
}
