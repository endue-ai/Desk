/**
 * A request to change the desk's look, said to Eris (docs/ko/theme-requirements.md TS-07): a word for
 * the look (theme, look, "make it feel"; 테마, 느낌, 분위기), a request (make, change, "feel like";
 * 으로, 처럼, 바꿔) and a feeling beside them (any other word), about the desk itself. Desk's people
 * build apps, so a sentence that names something else they make (an app, a page, code, a framework)
 * or puts a possessive before anything but the desk stays in Eris's conversation; "desk", "데스크",
 * "workspace", "everything", "전체", "여기" and a bare "it" keep it about the desk. The composer hands
 * a look request to the theme studio's Describe tab, which runs it; "Send to Eris instead" there hands
 * a misfire back (SAY_TO_ERIS). The conversation's brain is not offered propose_theme, so the words
 * decide.
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
/** Something else the person is building (or its plural): its look is not the desk's. */
const BUILDING = new Set(
  (
    "app page site website screen component button function code file project repo repository " +
    "repositories provider form layout logo icon css login landing react next.js nextjs vue " +
    "svelte tailwind angular astro nuxt remix bootstrap"
  ).split(" "),
);
const KO_BUILDING =
  /앱|페이지|사이트|화면|컴포넌트|버튼|함수|코드|파일|프로젝트|레포|로그인|랜딩|폼|레이아웃|로고|아이콘/;
/** A possessive before anything but the desk: "my app", "우리 서비스" are theirs, "my desk" is the desk. */
const THEIRS = /\b(my|our|your)\s+(?!(desk|desks|workspace)\b)\w|(^|\s)(내|우리)\s+(?!데스크)\S/i;

/** Whether `text` asks to change the look and says how it should feel. */
export function isLookRequest(text: string): boolean {
  if (!LOOK.test(text) || !ASK.test(text) || THEIRS.test(text) || KO_BUILDING.test(text))
    return false;
  const words = (text.toLowerCase().match(/[a-z][a-z0-9.]*/g) ?? []).map((w) =>
    w.replace(/\.+$/, ""),
  );
  if (words.some((w) => BUILDING.has(w) || BUILDING.has(w.replace(/s$/, "")))) return false;
  const english = words.filter((w) => !PLAIN.has(w));
  const korean = text.split(/\s+/).filter((w) => /[가-힣]/.test(w) && !KO_PLAIN.test(w));
  return english.length + korean.length > 0;
}

/** The event the studio raises (bubbling, `detail.text`) to say a sentence to Eris after all. */
export const SAY_TO_ERIS = "desk:say-to-eris";

/** What Eris says as she opens the studio on it. */
export const LOOK_REPLY = {
  ko: "데스크에 입혀 볼게요.",
  en: "Let me show it on the desk.",
} as const;
