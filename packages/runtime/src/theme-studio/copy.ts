/** The theme studio's words, in the shell's two languages. */
export type StudioLang = "ko" | "en";

const KO = {
  title: "테마",
  open: "테마 스튜디오",
  search: "테마 찾기",
  all: "전체",
  apply: "적용",
  close: "닫기",
  current: "지금 테마",
  previewing: "미리보는 중",
  endueName: "endue",
  endueDescription: "데스크의 기본 테마. 밝음과 어두움, 고대비를 모두 갖췄어요.",
  by: "만든 이",
  empty: "맞는 테마가 없어요.",
  applied: "적용됨",
  light: "밝음",
  dark: "어두움",
  hint: "화살표로 미리보고 Enter 로 적용해요. Esc 는 되돌리고 닫아요.",
  gallery: "테마 목록",
};

const EN: typeof KO = {
  title: "Themes",
  open: "Theme studio",
  search: "Find a theme",
  all: "All",
  apply: "Apply",
  close: "Close",
  current: "In use",
  previewing: "Previewing",
  endueName: "endue",
  endueDescription: "The desk's own theme: light and dark, with high contrast.",
  by: "By",
  empty: "No theme matches.",
  applied: "Applied",
  light: "Light",
  dark: "Dark",
  hint: "Arrows preview, Enter applies, Escape goes back and closes.",
  gallery: "Themes",
};

export type StudioCopy = keyof typeof KO;

export function studioText(lang: StudioLang, key: StudioCopy): string {
  return (lang === "en" ? EN : KO)[key];
}
