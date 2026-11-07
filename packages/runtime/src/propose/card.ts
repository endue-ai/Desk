/**
 * The runtime's own card for what Eris proposes that is not a view (ADR 0073): a profile drawn as a
 * ghost, key bindings as a table, a pack as what it brings (ADR 0108). It floats over the desk with Apply, Try again (with what should
 * change) and Discard, and answers with the person's choice as desk.views.preview does. Once applied
 * it says so with Undo. It belongs to the runtime, not to a plugin, because a profile may turn the
 * plugins off, desk.views among them, and the way back must outlive the switch. Escape is Discard
 * (or Close once applied); a newer preview discards an older one.
 */
import { drawProfile, type ProfileModel } from "./ghost";
import { drawKeys, type KeyRow } from "./keys-table";
import type { Choice } from "./pipeline";

export type CardContent =
  | { kind: "profile"; title: string; model: ProfileModel }
  | { kind: "keys"; title: string; rows: KeyRow[] }
  | { kind: "pack"; title: string; rows: Array<[string, string]> };

export interface Card {
  /** Show a proposal and wait for the person's choice. */
  preview(content: CardContent, note: string): Promise<Choice>;
  /** Show what was applied, with Undo running `undo`. */
  applied(content: CardContent, text: string, undo: () => unknown): void;
  /** Take the card away; a preview still waiting is discarded. */
  close(): void;
}

const DISCARD: Choice = { choice: "discard" };
const CHOICES = [
  ["apply", "Apply"],
  ["retry", "Try again"],
  ["discard", "Discard"],
] as const;

export function createCard(host: HTMLElement): Card {
  const doc = host.ownerDocument;
  let shown: HTMLElement | null = null;
  let waiting: ((choice: Choice) => void) | null = null;
  const settle = (choice: Choice) => {
    const was = waiting;
    waiting = null;
    was?.(choice);
  };
  const take = () => {
    shown?.remove();
    shown = null;
  };
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ) => {
    const el = doc.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (label: string, data: Record<string, string>, primary = false) => {
    const el = make("button", primary ? "proposal-button is-primary" : "proposal-button", label);
    el.type = "button";
    Object.assign(el.dataset, data);
    return el;
  };

  /** The card's frame for `content`: badge, title, note and the kind's drawing. */
  const frame = (content: CardContent, state: string, note: string, onEscape: () => void) => {
    take();
    const card = make("section", "proposal");
    card.dataset.proposal = content.kind;
    card.dataset.state = state;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Eris's proposal: ${content.title}`);
    const head = make("header", "proposal-head");
    const badge = state === "applied" ? "Applied" : "Preview";
    head.append(make("span", "proposal-badge", badge), make("h2", "proposal-title", content.title));
    const said = make("p", "proposal-note", note);
    said.setAttribute("role", "status");
    const body = make("div", "proposal-body");
    body.append(
      content.kind === "profile"
        ? drawProfile(doc, content.model)
        : content.kind === "keys"
          ? drawKeys(doc, content.rows)
          : drawPack(content.rows),
    );
    card.append(head, said, body);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.isComposing) return;
      // The card's own: the desk's keymap (desk.keys.quit) does not see it.
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    });
    host.append(card);
    shown = card;
    return { card, said };
  };

  /** What a pack brings, as a list of label and value (ADR 0108). */
  const drawPack = (rows: Array<[string, string]>) => {
    const list = make("dl", "proposal-pack");
    for (const [label, value] of rows) list.append(make("dt", "", label), make("dd", "", value));
    return list;
  };

  return {
    preview(content, note) {
      settle(DISCARD);
      let pick = (_choice: string) => {};
      const { card, said } = frame(content, "preview", note, () => pick("discard"));
      const field = make("input", "proposal-correction");
      field.type = "text";
      field.setAttribute("aria-label", "What should change");
      field.placeholder = "What should change? Try again sends it to Eris.";
      // A pack is data the desk has: there is nothing for Eris to try again (ADR 0108).
      const offered = CHOICES.filter(([choice]) => content.kind !== "pack" || choice !== "retry");
      const buttons = offered.map(([choice, label]) =>
        button(label, { choice }, choice === "apply"),
      );
      pick = (choice) => {
        if (card.dataset.state !== "preview") return;
        if (choice === "discard") {
          settle(DISCARD);
          take();
          return;
        }
        card.dataset.state = "busy";
        for (const el of [...buttons, field]) el.disabled = true;
        said.textContent = choice === "apply" ? "Saving…" : "Eris is trying again…";
        const correction = field.value.trim();
        settle(
          choice === "apply"
            ? { choice: "apply" }
            : { choice: "retry", ...(correction ? { correction } : {}) },
        );
      };
      for (const el of buttons) el.addEventListener("click", () => pick(el.dataset.choice ?? ""));
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        pick("retry");
      });
      const actions = make("div", "proposal-actions");
      actions.append(...buttons);
      if (content.kind !== "pack") card.append(field);
      card.append(actions);
      const answer = new Promise<Choice>((resolve) => {
        waiting = resolve;
      });
      buttons[0]?.focus({ preventScroll: true });
      return answer;
    },

    applied(content, text, undo) {
      settle(DISCARD);
      const { card } = frame(content, "applied", text, take);
      const back = button("Undo", { action: "undo" }, true);
      const close = button("Close", { action: "close" });
      back.addEventListener("click", () => {
        back.disabled = true;
        void undo();
      });
      close.addEventListener("click", take);
      const actions = make("div", "proposal-actions");
      actions.append(back, close);
      card.append(actions);
      back.focus({ preventScroll: true });
    },

    close() {
      settle(DISCARD);
      take();
    },
  };
}
