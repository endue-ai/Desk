// The card in front on the island (ADR 0204): a permission prompt or an agent's approval (ADR 0078),
// in the permissions plugin's own words (its pure models, so the overlay and the island never say a
// request differently), with the same choices, and the bridge call each choice answers with.
import type { PluginInfo } from "@endue-ai/bridge";
import { type ApprovalModel, approvalModel } from "../../../plugins/permissions/ui/approval.js";
import { type PromptModel, promptModel } from "../../../plugins/permissions/ui/model.js";
import type { Ask } from "./island-model";
import "./island-card.css";

/** One way to answer a card: what goes back to the core and the button's words. */
export interface Choice {
  answer: string;
  label: string;
  /** The way that refuses: it is never the one a stray Enter presses. */
  refuses?: boolean;
}

export type Card =
  | { kind: "prompt"; id: string; model: PromptModel; choices: Choice[] }
  | { kind: "approval"; id: string; model: ApprovalModel; choices: Choice[] };

const MANAGE = { permission: "perm:manage" } as const;

/** The card for the ask in front, with how many wait behind it. */
export function cardOf(ask: Ask, plugins: PluginInfo[], waiting: number): Card {
  if (ask.kind === "prompt") {
    const model = promptModel(ask.data, plugins, waiting);
    const choices: Choice[] = [
      { answer: "once", label: "Allow once" },
      { answer: "session", label: "Allow this session" },
      { answer: "always", label: "Always allow" },
      ...(model.parent ? [{ answer: "parent", label: model.parent.label }] : []),
      { answer: "refuse", label: "Don't allow", refuses: true },
    ];
    return { kind: "prompt", id: ask.id, model, choices };
  }
  const model = approvalModel(ask.data, plugins, waiting);
  const choices: Choice[] = [
    { answer: "once", label: "Allow once" },
    ...(model.task ? [{ answer: "task", label: "Allow for this task" }] : []),
    { answer: "deny", label: "Deny", refuses: true },
  ];
  return { kind: "approval", id: ask.id, model, choices };
}

/** An ask's title alone, for the ones that wait behind the card. */
export function titleOf(ask: Ask, plugins: PluginInfo[]): string {
  return cardOf(ask, plugins, 0).model.title;
}

/** The bridge call that answers `ask` with `answer`, or undefined for an answer it does not take. */
export function answerCall(
  ask: Ask,
  answer: string,
):
  | { method: "perm.answer"; params: Record<string, unknown> }
  | { method: "perm.approve"; params: Record<string, unknown> }
  | undefined {
  if (ask.kind === "prompt") {
    if (answer === "refuse")
      return { method: "perm.answer", params: { promptId: ask.id, granted: false, scope: MANAGE } };
    if (answer === "parent") {
      if (!ask.data.parent) return undefined;
      const params = { promptId: ask.id, granted: true, parent: true, scope: MANAGE };
      return { method: "perm.answer", params };
    }
    if (answer !== "once" && answer !== "session" && answer !== "always") return undefined;
    const params = { promptId: ask.id, granted: true, duration: answer, scope: MANAGE };
    return { method: "perm.answer", params };
  }
  if (answer === "task" && !ask.data.task) return undefined;
  if (answer !== "once" && answer !== "task" && answer !== "deny") return undefined;
  return { method: "perm.approve", params: { approvalId: ask.id, answer, scope: MANAGE } };
}

/** The card's DOM; `answer` hears the choice pressed. */
export function renderCard(
  doc: Document,
  card: Card,
  answer: (choice: string) => void,
): HTMLElement {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const box = el("section", "island-card");
  box.dataset.kind = card.kind;
  box.setAttribute("aria-label", card.model.title);
  box.append(el("h2", "island-card-title", card.model.title));
  if (card.kind === "prompt") {
    const { model } = card;
    box.append(el("p", "island-card-who", `${model.caller.kind} · ${model.caller.id}`));
    const what = model.scope ? `${model.permission}: ${model.scope}` : model.permission;
    box.append(el("p", "island-card-what", what));
    if (model.warning) box.append(el("p", "island-card-warning", model.warning));
    box.append(el("p", "island-card-why", model.reason ? `“${model.reason}”` : "No reason given."));
    box.append(el("p", "island-card-asked", `Asked for: ${model.duration}`));
  } else {
    const { model } = card;
    box.append(el("p", "island-card-who", `${model.caller.kind} · ${model.caller.id}`));
    box.append(el("p", "island-card-what", `${model.action}: ${model.target}`));
    if (model.preview) {
      const pre = el("pre", "island-card-preview");
      pre.tabIndex = 0;
      pre.setAttribute("aria-label", "Preview");
      for (const line of model.preview.lines) {
        const row = el("span", `island-line-${line.change}`, line.text);
        pre.append(row, doc.createTextNode("\n"));
      }
      box.append(pre);
      if (model.preview.truncated)
        box.append(el("p", "island-card-asked", "More changes are not shown."));
    }
    if (model.size) box.append(el("p", "island-card-asked", model.size));
    if (model.task) box.append(el("p", "island-card-asked", model.task));
  }
  const actions = el("div", "island-card-actions");
  for (const choice of card.choices) {
    const button = el("button", choice.refuses ? "island-choice island-refuse" : "island-choice");
    button.type = "button";
    button.textContent = choice.label;
    button.dataset.answer = choice.answer;
    button.addEventListener("click", () => answer(choice.answer));
    actions.append(button);
  }
  box.append(actions);
  if (card.model.waiting > 0) {
    const more = card.model.waiting === 1 ? "1 more waits" : `${card.model.waiting} more wait`;
    box.append(el("p", "island-card-asked", more));
  }
  return box;
}
