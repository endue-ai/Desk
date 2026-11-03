/** Labels for the person's controls at the bottom left of the desk. */
import type { Lang } from "../shell/copy";

const copy = {
  controls: ["사용자 메뉴", "User menu"],
  inbox: ["인박스", "Inbox"],
  settings: ["설정 열기", "Open settings"],
  account: ["사용자 정보", "User information"],
  localUser: ["로컬 사용자", "Local user"],
  local: ["이 기기에서 사용 중", "On this device"],
  profile: ["프로필", "Profile"],
  space: ["스페이스", "Space"],
} as const;

export const accountText = (lang: Lang, key: keyof typeof copy): string =>
  copy[key][lang === "ko" ? 0 : 1];
