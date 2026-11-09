/**
 * Every line of Settings, endue account (ADR 0130), in Korean and English. The wording follows
 * endue.ai's Account and General settings where they have a line for the same setting, so the two
 * read alike; sign-in lines follow the account popover's (system/account-copy.ts).
 */
import type { AccountNotificationKind } from "@endue-ai/bridge";
import type { SettingsLanguage } from "./copy";

const copy = {
  title: ["endue 계정", "endue account"],
  signedOutTitle: ["endue ID 로 로그인", "Sign in with endue ID"],
  signedOutHint: [
    "로그인하면 endue.ai 의 프로필, 언어와 시간대, 알림 설정이 여기에 나타나고 여기서 바꿀 수 있습니다.",
    "Sign in to see and change your endue.ai profile, language and time zone, and notifications here.",
  ],
  sidebarHint: ["프로필 · 언어 · 알림", "Profile · Language · Notifications"],
  signIn: ["endue ID 로 로그인", "Sign in with endue ID"],
  createAccount: ["회원가입", "Create account"],
  confirmCode: [
    "브라우저의 endue ID 페이지에서 이 코드를 확인하세요.",
    "Confirm this code on the endue ID page in your browser.",
  ],
  openAgain: ["브라우저 다시 열기", "Open browser again"],
  cancel: ["취소", "Cancel"],
  loading: ["계정 설정을 불러오는 중…", "Loading your account settings…"],
  retry: ["다시 시도", "Try again"],
  profile: ["개인정보", "Profile"],
  name: ["이름", "Name"],
  namePlaceholder: ["표시 이름", "Display name"],
  avatarUrl: ["아바타 URL", "Avatar URL"],
  avatarHint: ["비우면 사진을 지웁니다.", "Leave it empty to remove the picture."],
  nameInvalid: ["이름을 1~200자로 입력해주세요.", "Enter a name of 1 to 200 characters."],
  urlInvalid: [
    "올바른 URL(http:// 또는 https://)을 입력해주세요.",
    "Please enter a valid URL (http:// or https://).",
  ],
  save: ["저장", "Save"],
  saving: ["저장 중…", "Saving…"],
  saved: ["endue 계정에 저장했습니다.", "Saved to your endue account."],
  saveFailed: ["저장하지 못했습니다", "Couldn't save"],
  email: ["이메일", "Email"],
  userId: ["사용자 ID", "User ID"],
  status: ["상태", "Status"],
  joined: ["가입일", "Joined"],
  active: ["활성", "Active"],
  inactive: ["비활성", "Inactive"],
  suspended: ["정지됨", "Suspended"],
  languageRegion: ["언어 및 지역", "Language & Region"],
  displayLanguage: ["표시 언어", "Display Language"],
  displayLanguageHint: [
    "endue.ai 에서 쓰는 언어입니다. Desk 화면은 이 컴퓨터의 언어를 따릅니다.",
    "The language endue.ai uses. Desk itself follows this computer's language.",
  ],
  notChosen: ["선택 안 함", "Not chosen"],
  timeZone: ["시간대", "Timezone"],
  timeZoneHint: ["예약과 날짜 표시에 쓰입니다", "Used for scheduling and date display"],
  computerZone: ["이 컴퓨터의 시간대는 {zone} 입니다.", "This computer is set to {zone}."],
  useComputerZone: ["이 시간대로 바꾸기", "Use this time zone"],
  notifications: ["알림", "Notifications"],
  notificationsHint: [
    "endue.ai 인박스에 받을 알림입니다. 푸시 알림은 기기마다 endue.ai 에서 켜세요.",
    "What reaches your endue.ai inbox. Turn on push notifications on endue.ai, on each device.",
  ],
  signOutGroup: ["로그인", "Sign-in"],
  signOut: ["로그아웃", "Sign Out"],
  signOutHint: ["이 Desk 의 로그인만 끝냅니다.", "Ends this desk's session only."],
  partFailed: ["endue 가 이 설정에 답하지 않았습니다.", "endue did not answer for these settings."],
  offline: [
    "endue 에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.",
    "Desk could not reach endue. Check your connection and try again.",
  ],
  forbidden: ["endue 가 이 요청을 거절했습니다.", "endue turned this request down."],
  footnote: [
    "변경사항은 endue 계정에 바로 저장되어 endue.ai 에도 함께 적용됩니다.",
    "Changes are saved to your endue account at once and apply on endue.ai too.",
  ],
} as const;
export type AccountCopy = keyof typeof copy;

export const accountText = (
  lang: SettingsLanguage,
  key: AccountCopy,
  vars: Record<string, string> = {},
): string =>
  copy[key][lang === "ko" ? 0 : 1].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

/** Each kind of notification as endue.ai's settings name it: label and when it comes. */
const KINDS: Record<AccountNotificationKind, [[string, string], [string, string]]> = {
  "conversation-reply": [
    ["에이전트 답변", "자리를 비운 동안 에이전트가 답을 마쳤을 때"],
    ["Agent Replies", "When an agent finishes a response while you are away"],
  ],
  "routine-completed": [
    ["예약 완료", "예약 실행이 끝났을 때"],
    ["Schedule Completed", "When a scheduled run completes"],
  ],
  "routine-failed": [
    ["예약 실패", "예약 실행이 실패했을 때"],
    ["Schedule Failed", "When a scheduled run fails"],
  ],
  "routine-skipped": [
    ["예약 건너뜀", "사용 한도에 닿아 예약 실행을 건너뛰었을 때"],
    ["Schedule Skipped", "When a scheduled run is skipped because a usage limit was reached"],
  ],
  "agent-notice": [
    ["에이전트 알림", "예약 실행 중 에이전트가 알려야 할 일이 있다고 판단했을 때"],
    ["Agent Notices", "When an agent decides you need to know something during a scheduled run"],
  ],
};

export function kindText(
  lang: SettingsLanguage,
  kind: AccountNotificationKind,
): { label: string; hint: string } {
  const [label, hint] = KINDS[kind][lang === "ko" ? 0 : 1];
  return { label, hint };
}
