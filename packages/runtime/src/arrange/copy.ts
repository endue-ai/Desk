/** What arranging windows says (ADR 0116): the right-edge strip and its commands. */
import type { Lang } from "../shell/copy";

const copy = {
  strip: ["창 정리", "Arrange windows"],
  tile: ["창 바둑판 배열", "Tile windows"],
  cascade: ["창 계단식 배열", "Cascade windows"],
  restore: ["이전 창 배치로 되돌리기", "Restore previous layout"],
  nothingToArrange: [
    "이 데스크톱에는 정리할 창이 없습니다",
    "No normal window on this desktop to arrange",
  ],
  nothingToRestore: ["되돌릴 창 배치가 없습니다", "No earlier layout to restore"],
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
