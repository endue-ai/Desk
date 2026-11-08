/**
 * The floating Eris (ADR 0121): her figure over the OS while the desk is inactive, what she is doing
 * under it (idle, listening, thinking, speaking, waiting for an approval), and, a click away, a
 * compact composer that talks to her in the desk's one conversation. The native host gives it the
 * core as the desk and the window's own moves (grow, fold, drag, go away, bring the desk forward);
 * this view knows no Tauri. Esc sends her away; a drag moves the window; a click opens and folds.
 */
import type { Clock } from "../clock";
import { h, listen, render } from "../shell/dom";
import { icon } from "../shell/icons";
import { mountFigure } from "./figure";
import {
  type ErisLine,
  type ErisSnapshot,
  type FloatStatus,
  floatSide,
  keepLines,
  type LinkChannel,
  statusOf,
} from "./float";
import { type FloatCopy, type FloatLang, floatText, statusText } from "./float-copy";
import { askEris, type FloatCore, watchBrain } from "./float-turn";
import type { ErisState } from "./states";
import { MS_PER_CHAR } from "./talk";

export interface FloatHost {
  core: FloatCore;
  channel: LinkChannel;
  clock: Clock;
  lang: FloatLang;
  /** The shortcut that summons her and how it reads; undefined while the desk holds none. */
  shortcut(): { combo: string; label: string } | undefined;
  reduced(): boolean;
  /** Go away: Esc, or the shortcut while she is in front. */
  dismiss(): void;
  /** Grow the window for her composer, or fold it back to her figure. */
  expand(open: boolean): void;
  /** Bring the desk forward (an approval waits there). */
  reveal(): void;
  /** Move the window with the pointer. */
  drag(): void;
}

export interface ErisFloat {
  el: HTMLElement;
  /** Open her composer with the focus in it (the shortcut summoned her). */
  open(): void;
  /** Fold her composer (the window went away). */
  fold(): void;
  /** The theme changed. */
  restyle(): void;
  /** The shortcut changed. */
  refresh(): void;
  dispose(): void;
}

/** A press that moves this far is a drag, not a click. */
const DRAG_PX = 4;
const SPEAK_TAIL_MS = 400;
const SPEAK_MAX_MS = 8000;

/** How her figure looks for what she shows. */
function lookOf(status: FloatStatus, state: ErisState): ErisState {
  if (status === "approval") return "heads-up";
  if (status === "thinking" || status === "listening") return status;
  return state === "thinking" || state === "listening" ? "idle" : state;
}

export function mountErisFloat(root: HTMLElement, host: FloatHost): ErisFloat {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const tr = (key: FloatCopy, vars?: Record<string, string>) => floatText(host.lang, key, vars);
  const link = floatSide(host.channel);
  let snapshot: ErisSnapshot | undefined = link.snapshot();
  let lines: ErisLine[] = snapshot?.lines ?? [];
  let heard = snapshot?.saying ?? "";
  let mine = "";
  let open = false;
  let asking = false;
  let composing = false;
  let failure = "";
  let speakingUntil = Number.NEGATIVE_INFINITY;
  let drawn = "";
  let listed = "";
  // Every frame redraws what changed (her speaking ends with time); `draw` is set below.
  let redraw = () => {};

  const figure = mountFigure({ clock: host.clock, reduced: host.reduced, tick: () => redraw() });
  figure.el.classList.add("eris-float-figure");
  figure.el.setAttribute("role", "button");
  figure.el.setAttribute("tabindex", "0");
  figure.el.setAttribute("aria-controls", "eris-float-panel");
  const status = h("p", { class: "eris-float-status", role: "status" });
  const list = h("ol", { class: "eris-float-lines", "aria-label": tr("conversation") });
  const empty = h("p", { class: "eris-float-empty" });
  const reveal = h(
    "button",
    { class: "btn btn-xs eris-float-reveal", type: "button", onClick: () => host.reveal() },
    tr("reveal"),
  );
  const approval = h(
    "div",
    { class: "eris-float-approval", hidden: true },
    h("span", {}, tr("approval")),
    reveal,
  );
  const error = h("p", { class: "eris-float-error", role: "alert", hidden: true });
  const input = h("input", {
    class: "input eris-float-input",
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": tr("talk"),
    placeholder: tr("placeholder"),
  });
  const send = h(
    "button",
    { class: "btn btn-primary eris-float-send", type: "submit" },
    tr("send"),
  );
  const fold = h(
    "button",
    {
      class: "icon-button eris-float-fold",
      type: "button",
      "aria-label": tr("fold"),
      title: tr("fold"),
      onClick: () => setOpen(false),
    },
    icon("close", 16),
  );
  const form = h("form", { class: "eris-float-composer" }, input, send, fold);
  const panel = h(
    "section",
    { class: "eris-float-panel", id: "eris-float-panel", "aria-label": tr("talk"), hidden: true },
    list,
    empty,
    approval,
    error,
    form,
  );
  const el = h(
    "div",
    { class: "eris-float", "data-status": "idle", "data-open": "false" },
    h("div", { class: "eris-float-stage" }, figure.el, status),
    panel,
  );
  root.replaceChildren(el);

  const brain = watchBrain(host.core, () => redraw());

  const draw = () => {
    const state = snapshot?.state ?? "idle";
    const shown = statusOf({
      state,
      talk: snapshot?.talk ?? "off",
      thinking: asking || brain.thinking(),
      speaking: host.clock.now() < speakingUntil,
      approval: brain.approval(),
    });
    const key = host.shortcut();
    const now = JSON.stringify([shown, state, open, asking, failure, key, lines.length]);
    if (now !== drawn) {
      drawn = now;
      const label = statusText(host.lang, shown);
      figure.set(lookOf(shown, state));
      el.dataset.status = shown;
      el.dataset.open = String(open);
      status.textContent = label;
      figure.el.setAttribute("aria-label", `${tr("figure")}: ${label}`);
      figure.el.setAttribute("aria-expanded", String(open));
      if (key) figure.el.setAttribute("aria-keyshortcuts", key.combo);
      else figure.el.removeAttribute("aria-keyshortcuts");
      panel.hidden = !open;
      approval.hidden = shown !== "approval";
      error.hidden = !failure;
      error.textContent = failure;
      send.disabled = asking;
      empty.hidden = lines.length > 0;
      empty.textContent = key ? `${tr("empty")} ${tr("hint", { key: key.label })}` : tr("empty");
    }
    const text = JSON.stringify(lines);
    if (text === listed) return;
    listed = text;
    render(list, () =>
      lines.map((line) =>
        h(
          "li",
          { class: "eris-float-line", "data-who": line.who },
          h("span", { class: "eris-float-who" }, tr(line.who)),
          h("span", { class: "eris-float-text" }, line.text),
        ),
      ),
    );
    list.scrollTop = list.scrollHeight;
  };
  redraw = draw;

  /** She says `text`: speaking for as long as the line takes, a pulse per syllable. */
  const speak = (text: string) => {
    const ms = MS_PER_CHAR[host.lang];
    speakingUntil = host.clock.now() + Math.min(SPEAK_MAX_MS, text.length * ms + SPEAK_TAIL_MS);
    figure.speak(text, ms);
  };

  const setOpen = (next: boolean, tell = true) => {
    if (next !== open) {
      open = next;
      if (tell) host.expand(next);
      draw();
    }
    if (next) input.focus();
  };

  const ask = async () => {
    const text = input.value.trim();
    if (!text || asking) return;
    asking = true;
    failure = "";
    input.value = "";
    lines = keepLines(lines, { who: "you", text });
    link.back({ line: { who: "you", text }, state: "thinking" });
    draw();
    try {
      const answer = (await askEris(host.core, text)).trim();
      if (!answer) throw new Error("no answer");
      asking = false;
      mine = answer;
      lines = keepLines(lines, { who: "eris", text: answer });
      link.back({ line: { who: "eris", text: answer }, state: "idle", said: answer });
      speak(answer);
    } catch {
      asking = false;
      failure = tr("failed");
      // The question back in the field, to send again.
      if (!input.value) input.value = text;
      link.back({ state: "idle" });
    }
    draw();
  };

  let press: { x: number; y: number } | undefined;
  let dragged = false;
  const offs = [
    link.onSnapshot((next) => {
      snapshot = next;
      lines = next.lines;
      // A new line of hers from the desk: she says it here too (not her own answer coming back).
      if (next.saying && next.saying !== heard) {
        heard = next.saying;
        if (next.saying !== mine) speak(next.saying);
      }
      draw();
    }),
    listen(figure.el, "pointerdown", (e) => {
      const p = e as PointerEvent;
      if (p.button !== 0) return;
      press = { x: p.screenX, y: p.screenY };
      dragged = false;
    }),
    listen(win, "pointermove", (e) => {
      const p = e as PointerEvent;
      if (!press || Math.hypot(p.screenX - press.x, p.screenY - press.y) < DRAG_PX) return;
      press = undefined;
      dragged = true;
      host.drag();
    }),
    listen(win, "pointerup", () => {
      press = undefined;
    }),
    // A click that was not a drag opens or folds her composer.
    listen(figure.el, "click", () => {
      if (dragged) dragged = false;
      else setOpen(!open);
    }),
    listen(figure.el, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Enter" && k.key !== " ") return;
      k.preventDefault();
      setOpen(!open);
    }),
    listen(input, "compositionstart", () => {
      composing = true;
    }),
    listen(input, "compositionend", () => {
      composing = false;
    }),
    listen(input, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Enter" || k.isComposing || k.keyCode === 229) return;
      k.preventDefault();
      void ask();
    }),
    listen(form, "submit", (e) => {
      e.preventDefault();
      if (!composing) void ask();
    }),
    // Esc sends her away, unless it ends a composition (Korean, Japanese) in the field.
    listen(doc, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Escape" || k.isComposing || k.keyCode === 229) return;
      k.preventDefault();
      setOpen(false, false);
      host.dismiss();
    }),
  ];
  draw();

  return {
    el,
    open: () => setOpen(true),
    fold: () => setOpen(false, false),
    restyle: () => figure.restyle(),
    refresh: () => draw(),
    dispose() {
      for (const off of offs) off();
      brain.dispose();
      figure.dispose();
      el.remove();
    },
  };
}
