/**
 * Keyboard shortcuts: every command in the registry with its keys. "Change" records the next key
 * press (Esc cancels); a key another command had moves here, and the list says where it came from.
 * Changes are the person's layer of the keymap (`desk.keys.bindings`); desk.session keeps them.
 */

import { comboOf, formatCombo } from "../../input";
import { PERSONAL_KEYS } from "../../policies/keys";
import { isDefault, type KeyLayers, keysOf, rebind, reset } from "../../rebind";
import type { ShellCtx } from "../../shell/context";
import { h, listen, render } from "../../shell/dom";
import type { Mounted } from "../views";

const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

export function keysBody(ctx: ShellCtx): Mounted {
  const { runtime } = ctx;
  const layers = (): KeyLayers => ({
    contributed: runtime.policy().keys,
    personal: runtime.settings.get(PERSONAL_KEYS, []),
    platform: ctx.platform,
  });
  const titleOf = (id: string) => runtime.commands.list().find((c) => c.id === id)?.title ?? id;
  const list = h("ul", { class: "keys-list" });
  const note = h("p", { class: "keys-note", "aria-live": "polite" });
  const el = h(
    "div",
    { class: "keys-view" },
    h(
      "div",
      { class: "keys-head" },
      h(
        "button",
        {
          class: "btn btn-ghost btn-xs",
          type: "button",
          "data-key": "keys-reset-all",
          onClick: () => runtime.settings.set(PERSONAL_KEYS, []),
        },
        ctx.tr("keysResetAll"),
      ),
    ),
    note,
    list,
  );
  let recording: string | null = null;
  let stopRecording: (() => void) | null = null;

  const stop = () => {
    stopRecording?.();
    stopRecording = null;
    recording = null;
    draw();
  };

  const record = (command: string) => {
    stop();
    recording = command;
    note.textContent = "";
    stopRecording = listen(
      window,
      "keydown",
      (e) => {
        const k = e as KeyboardEvent;
        if (MODIFIERS.has(k.key) || k.isComposing) return;
        // The key is recorded, not run: nothing else (the desk's keymap included) sees it.
        k.preventDefault();
        k.stopImmediatePropagation();
        const combo = comboOf(k);
        if (combo !== "Escape") {
          const { personal, displaced } = rebind(layers(), command, combo);
          runtime.settings.set(PERSONAL_KEYS, personal);
          note.textContent = displaced ? ctx.tr("keysMoved", { x: titleOf(displaced) }) : "";
        }
        stop();
      },
      { capture: true },
    );
    draw();
  };

  const draw = () => {
    render(list, () =>
      runtime.commands.list().map((c) => {
        const keys = keysOf(layers(), c.id);
        const isRecording = recording === c.id;
        return h(
          "li",
          { class: `key-row${isRecording ? " is-recording" : ""}`, "data-command": c.id },
          h("span", { class: "key-label" }, c.title),
          h(
            "span",
            { class: "key-combo" },
            keys.length
              ? keys.map((k) => h("kbd", { class: "kbd" }, formatCombo(k, ctx.platform)))
              : h("span", { class: "pop-muted" }, ctx.tr("keysNone")),
          ),
          h(
            "button",
            {
              class: "btn btn-outline btn-xs",
              type: "button",
              "data-key": `keys-change-${c.id}`,
              "aria-pressed": String(isRecording),
              "aria-label": `${c.title} · ${isRecording ? ctx.tr("keysPress") : ctx.tr("keysChange")}`,
              onClick: () => (isRecording ? stop() : record(c.id)),
            },
            isRecording ? ctx.tr("keysPress") : ctx.tr("keysChange"),
          ),
          h(
            "button",
            {
              class: "btn btn-ghost btn-xs",
              type: "button",
              "data-key": `keys-reset-${c.id}`,
              "aria-label": `${c.title} · ${ctx.tr("keysReset")}`,
              disabled: isDefault(layers(), c.id),
              onClick: () => runtime.settings.set(PERSONAL_KEYS, reset(layers(), c.id)),
            },
            ctx.tr("keysReset"),
          ),
        );
      }),
    );
  };
  draw();
  const offs = [
    runtime.keymap.onChange(draw),
    ctx.store.watch((s) => [s.lang, s.modes, s.spaceAgents], draw),
  ];
  return {
    el,
    off: () => {
      if (recording) stop();
      for (const off of offs) off();
    },
  };
}
