/** Sample surface Eris made: tomorrow's list, as a universal list view with inline data (ADR 0103). */
import type { UniversalView } from "@endue-ai/bridge";

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

export function tomorrowView(lang: "ko" | "en"): UniversalView {
  const entries = ITEMS[lang].map((title, i) => ({ id: `tomorrow-${i + 1}`, title }));
  return { type: "list", source: { data: { entries } } };
}
