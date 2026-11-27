/**
 * Words of an endue agent's Studio board (ADR 0232), as endue.ai's Studio says them: the three
 * columns, their rows, the agent's sheet, and the sentence that says what the agent does. They
 * come from the surfaces' catalogs (`surface/messages`, ids `surface.board.*`, ADR 0250).
 */
import { type KeyOf, moduleText } from "../../i18n/messages";
import type { Lang } from "../../shell/copy";
import en from "../messages/en.json";
import ko from "../messages/ko.json";

const PREFIX = "surface.board";
const text = moduleText(PREFIX, { en, ko });

export type BoardKey = KeyOf<keyof typeof en, typeof PREFIX>;

export function boardText(
  lang: Lang,
  key: BoardKey,
  vars: Record<string, string | number> = {},
): string {
  return text(lang, key, vars);
}

/** The groups of words named by what endue AI sends: a channel's provider, a wallpaper, and so on. */
export type BoardGroup = "channel" | "wallpaper" | "trait" | "tool";

/**
 * The word for a key endue AI sends (`web_fetch`, `self_evolving`), read as its catalog id in
 * camelCase (`tool.webFetch`); undefined for a key the catalog has no word for.
 */
export function boardWord(lang: Lang, group: BoardGroup, key: string): string | undefined {
  const name = `${group}.${key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`;
  return Object.hasOwn(en, `${PREFIX}.${name}`) ? text(lang, name as BoardKey) : undefined;
}

/** A piece of the sentence: plain, in the brand's colour (`hl`), or a problem (`warn`). */
export interface Seg {
  text: string;
  tone?: "hl" | "warn";
}

/** What the sentence is made of: the ways in that are on, what handles a request, where it ends. */
export interface Capability {
  inputs: string[];
  skills: number;
  tools: number;
  outputs: string[];
  moreOutputs: number;
  broken: string[];
}

const hl = (text: string): Seg[] => [{ text, tone: "hl" }];

/** A template's text with each `{part}` put in as its pieces; plain pieces side by side join. */
function pieces(template: string, parts: Record<string, Seg[]>): Seg[] {
  const out: Seg[] = [];
  const add = (seg: Seg) => {
    const last = out.at(-1);
    if (!seg.text) return;
    if (last && !last.tone && !seg.tone) last.text += seg.text;
    else out.push({ ...seg });
  };
  let from = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    add({ text: template.slice(from, match.index) });
    for (const seg of parts[match[1] ?? ""] ?? []) add(seg);
    from = match.index + match[0].length;
  }
  add({ text: template.slice(from) });
  return out;
}

/**
 * The sentence under the agent's head: where requests come from, what handles them, where they
 * end. Each language's template (`does`) holds the order its words go in.
 */
export function capability(lang: Lang, f: Capability): Seg[] {
  const t = (key: BoardKey, vars?: Record<string, string | number>) => text(lang, key, vars);
  const how: BoardKey =
    f.skills && f.tools ? "doesBoth" : f.skills ? "doesSkills" : f.tools ? "doesTools" : "doesTalk";
  const list = f.outputs.join(" · ");
  const outputs = f.moreOutputs ? t("doesMore", { list, n: f.moreOutputs }) : list;
  const end = f.outputs.length ? t("doesEndWith", { list: outputs }) : t("doesEnd");
  const handles = pieces(t(how), {
    skills: hl(t("doesSkillsN", { n: f.skills })),
    tools: hl(t("doesToolsN", { n: f.tools })),
  });
  const broken: Seg[] = f.broken.length
    ? [{ text: ` ${t("doesBroken", { list: f.broken.join(" · ") })}`, tone: "warn" }]
    : [];
  return [
    ...pieces(t("does"), { inputs: hl(f.inputs.join(" · ")), how: handles, end: hl(end) }),
    ...broken,
  ];
}
