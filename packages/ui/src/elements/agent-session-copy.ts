import en from "./agent-session-en.json";
import ko from "./agent-session-ko.json";

const messages: Record<string, typeof en> = { en, ko };
export const sessionCopy = (lang = "en") => messages[lang.split("-")[0] ?? "en"] ?? en;
export type SessionCopy = typeof en;
export function recent(value: string | undefined, lang: string, now: number): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  const fmt = new Intl.RelativeTimeFormat(lang, { style: "short" });
  return minutes === 0
    ? sessionCopy(lang).now
    : minutes < 60
      ? fmt.format(-minutes, "minute")
      : minutes < 1440
        ? fmt.format(-Math.floor(minutes / 60), "hour")
        : fmt.format(-Math.floor(minutes / 1440), "day");
}
