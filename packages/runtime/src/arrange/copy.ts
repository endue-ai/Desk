/** What arranging windows says (ADR 0116): the right-edge strip, its commands and the spread. */
import type { Lang } from "../shell/copy";

const copy = {
  strip: ["창 정리", "Arrange windows"],
  tile: ["창 바둑판 배열", "Tile windows"],
  cascade: ["창 계단식 배열", "Cascade windows"],
  spread: ["창 펼쳐 보기", "Spread windows out"],
  restore: ["이전 창 배치로 되돌리기", "Restore previous layout"],
  nothingToArrange: [
    "이 데스크톱에는 정리할 창이 없습니다",
    "No normal window on this desktop to arrange",
  ],
  nothingToRestore: ["되돌릴 창 배치가 없습니다", "No earlier layout to restore"],
  spreadLabel: ["펼쳐 본 창", "Spread windows"],
  filter: ["제목으로 거르기", "Type to filter by title"],
  count: ["창 {n}개", "{n} windows"],
  countOf: ["창 {n}개 중 {m}개", "{m} of {n} windows"],
  hint: [
    "화살표·Tab 으로 고르고 Enter 로 열기 · Esc 로 닫기",
    "Arrows or Tab to choose · Enter to open · Esc to close",
  ],
  noMatch: ["‘{q}’ 와 맞는 창이 없습니다", "No window matches “{q}”"],
  asleep: ["잠든 창", "Asleep"],
  asleepLine: ["고르면 다시 불러옵니다", "Loads again when chosen"],
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
