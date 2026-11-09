/**
 * The choices Settings, endue account offers for the account's display language and time zone,
 * as endue.ai's General settings offer them (ADR 0130): the languages endue.ai has a dictionary for,
 * Korean only for an account already in it, and a short list of time zones with their UTC offset
 * today, the saved one and this computer's among them.
 */

export interface Choice {
  value: string;
  label: string;
}

/** endue.ai's languages, each named in itself. */
const LANGUAGES: Choice[] = [
  { value: "en-US", label: "English" },
  { value: "ja-JP", label: "日本語" },
  { value: "de-DE", label: "Deutsch" },
  { value: "fr-FR", label: "Français" },
];
/** endue.ai no longer offers Korean; an account already in it still sees it as its value. */
const CURRENT_ONLY: Choice[] = [{ value: "ko-KR", label: "한국어" }];

const ZONES = [
  "Asia/Seoul",
  "Asia/Tokyo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "UTC",
];

/** The languages to offer when the account's is `current` (absent while never chosen). */
export function languageChoices(current: string | undefined): Choice[] {
  if (!current || LANGUAGES.some((c) => c.value === current)) return LANGUAGES;
  const known = CURRENT_ONLY.find((c) => c.value === current);
  return [...LANGUAGES, known ?? { value: current, label: current }];
}

function known(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** This computer's IANA time zone, or undefined when the webview does not say. */
export function computerZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && known(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** `UTC+9`, `UTC-4`, `UTC+5:30` or `UTC` for `zone` at `now`; undefined when unknown. */
export function offsetOf(zone: string, now: Date): string | undefined {
  if (!known(zone)) return undefined;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return undefined;
    if (part === "GMT") return "UTC";
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
    if (!m) return undefined;
    const minutes = m[3] && m[3] !== "00" ? `:${m[3]}` : "";
    return `UTC${m[1]}${Number(m[2])}${minutes}`;
  } catch {
    return undefined;
  }
}

/** The time zones to offer: the short list, then the saved one and this computer's when missing. */
export function zoneChoices(
  saved: string | undefined,
  computer: string | undefined,
  now: Date = new Date(),
): Choice[] {
  const values = [...ZONES];
  for (const extra of [saved, computer]) if (extra && !values.includes(extra)) values.push(extra);
  return values.map((value) => {
    const offset = value === "UTC" ? undefined : offsetOf(value, now);
    return { value, label: offset ? `${value} (${offset})` : value };
  });
}
