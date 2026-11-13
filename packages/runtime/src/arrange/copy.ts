/**
 * What arranging windows says (ADR 0116): the right-edge strip, its commands and the spread, whose
 * chrome the compositor draws in the desk's language (`spreadCopy`, sent with the page's report).
 */
import type { Lang } from "../shell/copy";

const copy = {
  strip: ["창 정리", "Arrange windows"],
  tile: ["창 바둑판 배열", "Tile windows"],
  cascade: ["창 계단식 배열", "Cascade windows"],
  spread: ["창 펼쳐 보기", "Spread windows out"],
  focus: ["창으로 전환", "Switch to window"],
  close: ["창 닫기", "Close window"],
  popOut: ["창으로 꺼내기", "Pop out window"],
  dock: ["데스크로 되돌리기", "Move window back to the desk"],
  notOut: ["창으로 꺼낸 창이 아닙니다", "That window is not popped out"],
  notOne: [
    "플러그인 하나만 보이는 창만 꺼낼 수 있습니다",
    "Only a window that shows one plugin pops out",
  ],
  restore: ["이전 창 배치로 되돌리기", "Restore previous layout"],
  nothingToArrange: [
    "이 데스크톱에는 정리할 창이 없습니다",
    "No normal window on this desktop to arrange",
  ],
  nothingToRestore: ["되돌릴 창 배치가 없습니다", "No earlier layout to restore"],
  notHere: ["이 데스크톱에 없는 창입니다", "That window is not on this desktop"],
  spreadLabel: ["펼쳐 본 창", "Spread windows"],
  filter: ["제목으로 거르기", "Type to filter by title"],
  count: ["창 {n}개", "{n} windows"],
  countOf: ["창 {n}개 중 {m}개", "{m} of {n} windows"],
  hint: [
    "화살표·Tab 으로 고르고 Enter 로 열기 · Esc 로 닫기",
    "Arrows or Tab to choose · Enter to open · Esc to close",
  ],
  noMatch: ["‘{q}’ 와 맞는 창이 없습니다", "No window matches “{q}”"],
  option: ["{title}", "{title}"],
  optionAsleep: ["{title} · 잠든 창", "{title} · asleep"],
} as const;

export type ArrangeCopyKey = keyof typeof copy;

export function arrangeText(
  lang: Lang,
  key: ArrangeCopyKey,
  vars: Record<string, string | number> = {},
): string {
  const text: string = copy[key][lang === "ko" ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

/** The spread's words for the compositor, `{n}`, `{m}`, `{q}` and `{title}` left to fill in. */
export function spreadCopy(lang: Lang): Record<string, string> {
  const raw = (key: ArrangeCopyKey) => copy[key][lang === "ko" ? 0 : 1];
  return {
    label: raw("spreadLabel"),
    filter: raw("filter"),
    count: raw("count"),
    countOf: raw("countOf"),
    hint: raw("hint"),
    noMatch: raw("noMatch"),
    option: raw("option"),
    optionAsleep: raw("optionAsleep"),
  };
}
