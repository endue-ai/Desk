/**
 * A request to change the desk's look, said to Eris (docs/ko/theme-requirements.md TS-07): a word for
 * the look (theme, look, "make it feel"; 테마, 느낌, 분위기), a request (make, change, "feel like";
 * 으로, 처럼, 바꿔) and a feeling beside them (any other word). The composer hands such a sentence
 * to the theme studio's Describe tab, which runs it, instead of Eris's conversation. The
 * conversation's brain is not offered propose_theme, so the words decide.
 */
const LOOK = /\b(themes?|looks?|vibe)\b|\bmake\b.*\bfeel|테마|느낌|분위기/i;
const ASK =
  /\b(make|change|switch|turn|give|want|set)\b|\b(look|feel)s? like\b|으로|로(?=\s|$|[.!?])|처럼|하게|바꿔|만들어|해\s*줘/i;
/** Words that are neither a feeling nor the look: the request's own and the small ones. */
const PLAIN = new Set(
  (
    "theme themes look looks feel feels feeling vibe make change switch turn give want set like " +
    "it its the a an my me this that to into of and with how more less please can could would you " +
    "i is be desk"
  ).split(" "),
);
const KO_PLAIN = /^(테마|느낌|분위기|바꿔|만들어|해줘|데스크|지금)|^(이|그|저|좀|해|줘)$/;

/** Whether `text` asks to change the look and says how it should feel. */
export function isLookRequest(text: string): boolean {
  if (!LOOK.test(text) || !ASK.test(text)) return false;
  const english = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !PLAIN.has(w));
  const korean = text.split(/\s+/).filter((w) => /[가-힣]/.test(w) && !KO_PLAIN.test(w));
  return english.length + korean.length > 0;
}

/** What Eris says as she opens the studio on it. */
export const LOOK_REPLY = {
  ko: "데스크에 입혀 볼게요.",
  en: "Let me show it on the desk.",
} as const;
