/**
 * Bottom centre: the line you talk on. A 2 px line with a hint until focused, then a 48 px input that
 * doubles as the command palette. A sent line rises into the middle of the screen and is absorbed.
 */

import { clamp01, cubicBezier, easeOutExpo } from "../ease";
import { type Command, deskCommands, match } from "../system/commands";
import { format } from "../system/keys";
import type { ShellCtx } from "./context";
import { h, listen, render } from "./dom";

const ABSORB_MS = 1400;
const absorbEase = cubicBezier(0.55, 0, 0.85, 0.35);

export function mountComposer(root: HTMLElement, ctx: ShellCtx): () => void {
  const input = h("input", {
    class: "composer-input",
    id: "composer-input",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-controls": "composer-list",
    "aria-expanded": "false",
    "aria-label": ctx.tr("composerLabel"),
    placeholder: ctx.tr("composerLabel"),
  });
  const hint = h(
    "label",
    { class: "composer-hint", for: "composer-input" },
    ctx.tr("composerHint"),
  );
  const field = h("div", { class: "composer-field" }, input);
  const list = h("ul", {
    class: "popover composer-list",
    id: "composer-list",
    role: "listbox",
    hidden: true,
  });
  const el = h("div", { class: "composer" }, list, hint, field);
  root.append(el);
  let height = 2;
  let animation = 0;
  let found: Command[] = [];

  const fold = (open: boolean) => {
    const id = ++animation;
    const from = height;
    const to = open ? 48 : 2;
    el.classList.toggle("is-open", open);
    return ctx.ticker.animate(ctx.reduced() ? 0 : 220, easeOutExpo, (t) => {
      if (id !== animation) return;
      height = from + (to - from) * t;
      field.style.height = `${Math.round(height * 10) / 10}px`;
      hint.style.opacity = String(Math.round((1 - clamp01((height - 2) / 20)) * 100) / 100);
    });
  };
  field.style.height = "2px";

  const choices = (text: string): { label: string; key?: string; run: () => void }[] => {
    found = match(deskCommands(ctx), text);
    if (!text.trim()) return [];
    return [
      ...found.map((c) => {
        const key = ctx.keys.bindingsOf(c.id)[0];
        return { label: c.label, run: c.run, ...(key ? { key: format(key, ctx.platform) } : {}) };
      }),
      { label: ctx.tr("sayTo", { x: text.trim() }), run: () => void send(text) },
    ];
  };

  const drawList = () => {
    const s = ctx.store.get().composer;
    const options = s.open ? choices(s.text) : [];
    list.hidden = options.length === 0;
    input.setAttribute("aria-expanded", String(options.length > 0));
    const selected = Math.min(s.selected, Math.max(0, options.length - 1));
    input.setAttribute(
      "aria-activedescendant",
      options.length ? `composer-option-${selected}` : "",
    );
    render(list, () =>
      options.map((o, i) =>
        h(
          "li",
          {
            class: `composer-option${i === selected ? " is-selected" : ""}`,
            id: `composer-option-${i}`,
            role: "option",
            "aria-selected": String(i === selected),
            onPointerdown: (e: Event) => {
              e.preventDefault();
              execute(o.run);
            },
          },
          h("span", { class: "composer-label" }, o.label),
          o.key ? h("kbd", { class: "kbd" }, o.key) : null,
        ),
      ),
    );
    return options;
  };

  const close = () => {
    input.value = "";
    ctx.store.set({ composer: { open: false, text: "", selected: 0 } });
    input.blur();
  };

  const execute = (run: () => void) => {
    run();
    close();
  };

  /** The sent line floats up from the input and dissolves into the centre: soul text in reverse. */
  const send = async (text: string) => {
    // The line rises over the whole desk, so it lives on the shell, not inside the bottom edge.
    const host = (root.closest(".shell") as HTMLElement | null) ?? document.body;
    const frame = host.getBoundingClientRect();
    const rect = field.getBoundingClientRect();
    const ghost = h("div", { class: "absorb", "aria-hidden": "true" }, text);
    const y = rect.top + rect.height / 2 - frame.top;
    ghost.style.left = `${rect.left + rect.width / 2 - frame.left}px`;
    ghost.style.top = `${y}px`;
    host.append(ghost);
    const rise = frame.height / 2 - y;
    void ctx.ticker
      .animate(ctx.reduced() ? 200 : ABSORB_MS, ctx.reduced() ? (t) => t : absorbEase, (t) => {
        const move = ctx.reduced() ? 0 : t;
        ghost.style.transform = `translate(-50%, calc(-50% + ${(rise * move).toFixed(1)}px)) scale(${(1 - 0.6 * move).toFixed(3)})`;
        ghost.style.filter = `blur(${(10 * move).toFixed(2)}px)`;
        ghost.style.opacity = (1 - t).toFixed(3);
      })
      .then(() => ghost.remove());
    ctx.eris.setState("thinking");
    const reply = await ctx.bridge.brain.say(text);
    ctx.eris.say(reply.text, reply.words);
  };

  const offs = [
    ctx.store.watch(
      (s) => s.composer.open,
      (open) => {
        void fold(open);
        // Closed from anywhere (Escape, a command): leave nothing half-typed behind.
        if (!open && input.value) input.value = "";
        if (!open && document.activeElement === input) input.blur();
      },
    ),
    ctx.store.watch((s) => [s.composer, s.modes, s.lang, s.spaceId], drawList),
    listen(input, "focus", () =>
      ctx.store.set((s) => ({ composer: { ...s.composer, open: true } })),
    ),
    listen(input, "blur", () => {
      if (!input.value) ctx.store.set({ composer: { open: false, text: "", selected: 0 } });
    }),
    listen(input, "input", () =>
      ctx.store.set({ composer: { open: true, text: input.value, selected: 0 } }),
    ),
    listen(input, "keydown", (e) => {
      const k = e as KeyboardEvent;
      const options = drawList();
      const s = ctx.store.get().composer;
      if (k.key === "ArrowDown" || k.key === "ArrowUp") {
        k.preventDefault();
        const n = options.length || 1;
        const selected = (s.selected + (k.key === "ArrowDown" ? 1 : n - 1)) % n;
        ctx.store.set({ composer: { ...s, selected } });
      } else if (k.key === "Enter") {
        k.preventDefault();
        const option = options[Math.min(s.selected, options.length - 1)];
        if (option) execute(option.run);
      } else if (k.key === "Escape") {
        k.preventDefault();
        close();
      }
    }),
    listen(window, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (ctx.keys.recording || k.defaultPrevented) return;
      const active = document.activeElement;
      const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      const free = !active || active === document.body || active.classList.contains("shell");
      if (
        !typing &&
        free &&
        k.key.length === 1 &&
        !k.metaKey &&
        !k.ctrlKey &&
        !k.altKey &&
        k.key !== " "
      ) {
        input.focus();
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
  };
}
