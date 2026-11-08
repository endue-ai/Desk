/** The copy of what Eris knows (ADR 0124) in Korean and English: command titles and answers. */
import type { Lang } from "../shell/copy";

const ko = {
  cmdClosed: "창 · 최근에 닫은 창",
  cmdReopen: "창 · 닫은 창 다시 열기",
  cmdCapabilities: "여기서 할 수 있는 일",
  noneClosed: "최근에 닫은 창이 없어요.",
  notClosed: "최근에 닫은 창 중에 {id} 이(가) 없어요.",
};

const en: typeof ko = {
  cmdClosed: "Windows · Closed recently",
  cmdReopen: "Windows · Reopen a closed window",
  cmdCapabilities: "What can I do here",
  noneClosed: "No window was closed recently.",
  notClosed: "{id} is not among the windows closed recently.",
};

export type ErisContextCopyKey = keyof typeof ko;
const tables: Record<Lang, Record<ErisContextCopyKey, string>> = { ko, en };

export function ec(lang: Lang, key: ErisContextCopyKey, vars: Record<string, string> = {}): string {
  return tables[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}
