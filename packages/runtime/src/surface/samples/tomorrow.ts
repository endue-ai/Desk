/** Sample surface Eris made: tomorrow's list. */
import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";

const ITEMS = {
  ko: [
    "09:30 스탠드업 준비",
    "Theo 에게 회의록 보내기",
    "항공권 두 개 중 고르기",
    "14:00 겹치는 일정 정하기",
  ],
  en: [
    "Prepare for the 09:30 standup",
    "Send the meeting notes to Theo",
    "Pick one of the two flights",
    "Decide the 14:00 overlap",
  ],
};

export function tomorrowBody(ctx: ShellCtx): HTMLElement {
  return h(
    "ol",
    { class: "list-body" },
    ITEMS[ctx.store.get().lang].map((text, i) =>
      h(
        "li",
        { class: "list-row" },
        h("span", { class: "list-index" }, i + 1),
        h("span", {}, text),
      ),
    ),
  );
}
