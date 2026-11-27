/**
 * The notification centre's control (#307): a bell right after the status line, with how many
 * notices arrived since the panel was last open (none shown at 0, 99+ past 99). Its label says the
 * count, since the badge is only drawn, and whether the panel it opens is open.
 */
import type { Language } from "@endue-ai/bridge";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { centreText } from "./copy";

export interface Bell {
  readonly element: HTMLButtonElement;
  update(unread: number, open: boolean, lang: Language): void;
}

export function createBell(press: () => void): Bell {
  const count = h("span", { class: "desk-notify-count", "aria-hidden": "true", hidden: true });
  const element = h(
    "button",
    {
      type: "button",
      class: "btn btn-xs desk-notify-bell",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      onClick: press,
    },
    icon("bell", 14),
    count,
  );
  return {
    element,
    update: (unread, open, lang) => {
      const label = unread > 0 ? centreText(lang, "bellUnread", { count: unread }) : null;
      element.setAttribute("aria-label", label ?? centreText(lang, "bell"));
      element.title = centreText(lang, "bell");
      element.setAttribute("aria-expanded", String(open));
      count.hidden = unread === 0;
      count.textContent = unread === 0 ? "" : unread > 99 ? "99+" : String(unread);
    },
  };
}
