/**
 * Keyboard shortcuts: every command with its key. "Change" records the next key press (Esc cancels);
 * a key another command had moves here, and the list says where it came from.
 */

import { comboOf } from "../../input";
import type { ShellCtx } from "../../shell/context";
import { h, listen, render } from "../../shell/dom";
import { deskCommands } from "../../system/commands";
import { format } from "../../system/keys";
import type { Mounted } from "../views";

const MODIFIERS = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

export function keysBody(ctx: ShellCtx): Mounted {
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
          onClick: () => ctx.keys.reset(),
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
    ctx.keys.recording = false;
    draw();
  };

  const record = (command: string) => {
    stop();
    recording = command;
    ctx.keys.recording = true;
    note.textContent = "";
    stopRecording = listen(
      window,
      "keydown",
      (e) => {
        const k = e as KeyboardEvent;
        if (MODIFIERS.has(k.key) || k.isComposing) return;
        k.preventDefault();
        k.stopPropagation();
        const combo = comboOf(k);
        if (combo !== "Escape") {
          const displaced = ctx.keys.bind(command, combo);
          const label = deskCommands(ctx).find((c) => c.id === displaced)?.label ?? displaced;
          note.textContent = displaced ? ctx.tr("keysMoved", { x: label ?? "" }) : "";
        }
        stop();
      },
      { capture: true },
    );
    draw();
  };

  const draw = () => {
    render(list, () =>
      deskCommands(ctx).map((c) => {
        const keys = ctx.keys.bindingsOf(c.id);
        const isRecording = recording === c.id;
        return h(
          "li",
          { class: `key-row${isRecording ? " is-recording" : ""}`, "data-command": c.id },
          h("span", { class: "key-label" }, c.label),
          h(
            "span",
            { class: "key-combo" },
            keys.length
              ? keys.map((k) => h("kbd", { class: "kbd" }, format(k, ctx.platform)))
              : h("span", { class: "pop-muted" }, ctx.tr("keysNone")),
          ),
          h(
            "button",
            {
              class: "btn btn-outline btn-xs",
              type: "button",
              "data-key": `keys-change-${c.id}`,
              "aria-pressed": String(isRecording),
              "aria-label": `${c.label} · ${isRecording ? ctx.tr("keysPress") : ctx.tr("keysChange")}`,
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
              "aria-label": `${c.label} · ${ctx.tr("keysReset")}`,
              disabled: ctx.keys.isDefault(c.id),
              onClick: () => ctx.keys.reset(c.id),
            },
            ctx.tr("keysReset"),
          ),
        );
      }),
    );
  };
  draw();
  const offs = [
    ctx.keys.onChange(draw),
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
