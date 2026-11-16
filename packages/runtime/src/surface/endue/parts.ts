/** Pieces both endue windows draw (ADR 0129): a notice, an avatar, Studio's facts, a list, buttons. */
import type { ShellCtx } from "../../shell/context";
import { type Child, h } from "../../shell/dom";
import { facePicture, flipCard as turn } from "../../system/endue";
import type { EndueState, Read } from "../../system/endue-ids";
import { showOnDesk } from "../../system/endue-web";
import { type EndueKey, endueText } from "./copy";
import type { Fact, Line } from "./model";

export const text = (ctx: ShellCtx, key: EndueKey, vars?: Record<string, string | number>) =>
  endueText(ctx.store.get().lang, key, vars);

/** What a window says while it has nothing to show: signed out, reading, gone or unreachable. */
export function notice(ctx: ShellCtx, endue: EndueState, retry: () => void): HTMLElement {
  const key: EndueKey =
    endue.state === "off" ? "signedOut" : endue.state === "loading" ? "reading" : "gone";
  return h(
    "div",
    { class: "endue-notice", role: "status" },
    h("p", {}, endue.state === "offline" ? text(ctx, "barOffline") : text(ctx, key)),
    endue.state === "ready" || endue.state === "offline"
      ? h(
          "button",
          { class: "btn btn-xs btn-outline", type: "button", onClick: retry },
          text(ctx, "refresh"),
        )
      : null,
  );
}

/** A read that failed or is under way, said under the card's head. */
export function readLine(ctx: ShellCtx, read: Read<unknown> | undefined, retry: () => void): Child {
  if (read?.state === "loading")
    return h("p", { class: "endue-read", role: "status" }, text(ctx, "reading"));
  if (read?.state !== "failed") return null;
  return h(
    "p",
    { class: "endue-read is-failed", role: "alert" },
    read.signedOut ? text(ctx, "signedOut") : text(ctx, "readFailed", { why: read.why }),
    " ",
    h(
      "button",
      { class: "btn btn-xs btn-outline", type: "button", onClick: retry },
      text(ctx, "refresh"),
    ),
  );
}

/** An avatar: the face the core read (ADR 0232) when there is one, else the initial on its colour. */
export function avatar(
  initial: string,
  colour: string | undefined,
  big = false,
  picture?: string,
): HTMLElement {
  const face = facePicture(picture);
  return h(
    "span",
    {
      class: `endue-avatar${big ? " is-big" : ""}${face ? " has-face" : ""}`,
      "aria-hidden": "true",
      ...(colour ? { style: { "--endue-accent": colour } } : {}),
    },
    face ? h("img", { class: "avatar-face", src: face, alt: "", draggable: "false" }) : initial,
  );
}

export function facts(list: Fact[]): HTMLElement {
  return h(
    "dl",
    { class: "endue-facts" },
    list.map((fact) =>
      h(
        "div",
        {
          class: "endue-fact",
          "data-fact": fact.key,
          ...(fact.tone ? { "data-tone": fact.tone } : {}),
        },
        h("dt", {}, fact.label),
        h("dd", {}, fact.value),
      ),
    ),
  );
}

export function lines(title: string, list: Line[], key: string): Child {
  if (!list.length) return null;
  return [
    h("h3", { class: "endue-section" }, title),
    h(
      "ul",
      { class: "endue-lines", "data-list": key },
      list.map((line) =>
        h(
          "li",
          { class: "endue-line", ...(line.tone ? { "data-tone": line.tone } : {}) },
          h("span", { class: "endue-line-title" }, line.title),
          h("span", { class: "endue-line-meta" }, line.meta),
        ),
      ),
    ),
  ];
}

/**
 * The turn, in each face's head so it is in sight however long the face is: Studio on the front,
 * Card on the back. It takes the focus after a turn.
 */
export function flipButton(ctx: ShellCtx, side: "front" | "back", view: string): HTMLElement {
  return h(
    "button",
    {
      class: `btn btn-xs ${side === "front" ? "btn-primary" : "btn-outline"} endue-turn`,
      type: "button",
      "data-key": `${side}-flip-${view}`,
      "data-flip-focus": "",
      "data-action": side === "front" ? "studio" : "card",
      title: text(ctx, side === "front" ? "studioHint" : "backHint"),
      onClick: () => turn(ctx, view, side === "front"),
    },
    text(ctx, side === "front" ? "studio" : "backToCard"),
  );
}

/** One of endue.ai's pages a card opens: the action's name, its words and the page. */
export type Page = [action: string, label: EndueKey, url: string];

/**
 * A face's foot: Read again on the back, and endue.ai's own pages on both, each shown in a desk
 * window (ADR 0223).
 */
export function actions(
  ctx: ShellCtx,
  side: "front" | "back",
  pages: Page[],
  retry: () => void,
): HTMLElement {
  return h(
    "div",
    { class: "endue-actions" },
    side === "back"
      ? h(
          "button",
          { class: "btn", type: "button", "data-action": "refresh", onClick: retry },
          text(ctx, "refresh"),
        )
      : null,
    h("span", { class: "endue-spacer" }),
    pages.map(([action, label, url]) =>
      h(
        "button",
        {
          class: "btn btn-xs",
          type: "button",
          "data-action": action,
          title: text(ctx, "pageHint"),
          onClick: () => void showOnDesk(ctx, url).catch(() => undefined),
        },
        text(ctx, label),
      ),
    ),
  );
}
