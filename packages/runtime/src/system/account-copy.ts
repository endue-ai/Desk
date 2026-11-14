/**
 * Labels for the person's controls at the bottom left of the desk, and every line of endue ID's
 * sign-in (ADR 0111). The wording follows the endue.ai web where it has a line for the same moment
 * (refs/auth.md §2.2 and §4): its entry buttons, its callback errors and its "sign in again" dialog.
 */
import type { AccountStatus } from "../bridge/types";
import type { Lang } from "../shell/copy";

const copy = {
  controls: ["사용자 메뉴", "User menu"],
  launcher: ["플러그인 열기", "Open a plugin"],
  inbox: ["인박스", "Inbox"],
  settings: ["설정 열기", "Open settings"],
  account: ["사용자 정보", "User information"],
  localUser: ["로컬 사용자", "Local user"],
  local: ["이 기기에서 사용 중", "On this device"],
  profile: ["프로필", "Profile"],
  space: ["스페이스", "Space"],
  endueId: ["endue ID", "endue ID"],
  signedOut: ["로그인 안 됨", "Not signed in"],
  signingIn: ["브라우저에서 기다리는 중", "Waiting for the browser"],
  signedIn: ["로그인됨", "Signed in"],
  withEndue: ["endue ID 로 로그인됨", "Signed in with endue ID"],
  signIn: ["endue ID 로 로그인", "Sign in with endue ID"],
  createAccount: ["회원가입", "Create account"],
  signOut: ["로그아웃", "Sign out"],
  accountSettings: ["계정 설정", "Account settings"],
  retry: ["다시 시도", "Try again"],
  openAgain: ["브라우저 다시 열기", "Open browser again"],
  cancel: ["취소", "Cancel"],
  freeNote: ["카드 없이 무료로 시작합니다.", "Start free. No card required."],
  confirmCode: [
    "브라우저의 endue ID 페이지에서 이 코드를 확인하세요.",
    "Confirm this code on the endue ID page in your browser.",
  ],
  signUpHint: [
    "로그인 화면이 나오면 'Endue가 처음이신가요? 회원가입'을 누르세요.",
    "If the page asks you to sign in, choose “New to Endue? Create an account”.",
  ],
  enterCode: [
    "브라우저에서 {code} 를 확인해 주세요. 페이지를 열어 두었어요.",
    "Confirm {code} in your browser. I opened the page for you.",
  ],
  signedInLine: [
    "로그인됐어요. 이제 endue 와 함께 생각할게요.",
    "You're signed in. I'll think with endue from now on.",
  ],
  signInFailed: ["로그인을 시작하지 못했어요.", "Signing in did not start."],
  stillWaiting: [
    "지금은 endue 에 닿지 않아요. 코드는 아직 유효해요, 계속 확인할게요.",
    "Can't reach endue right now. The code still works; I'll keep checking.",
  ],
  slowWaiting: [
    "endue 가 조금 천천히 확인해 달래요. 계속 기다리는 중이에요.",
    "endue asked me to check less often. Still waiting.",
  ],
  // One line per reason (specs/bridge/v0 AccountProblem).
  offline: [
    "지금은 endue 에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
    "Can't reach endue right now. Check your connection and try again.",
  ],
  denied: ["브라우저에서 로그인을 거절했어요.", "The sign-in was turned down in the browser."],
  expired: [
    "인증 세션이 만료되었습니다. 다시 로그인해주세요.",
    "The sign-in code expired. Please sign in again.",
  ],
  "slow-down": [
    "로그인 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.",
    "Too many sign-in attempts. Wait a moment and try again.",
  ],
  unavailable: [
    "로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    "Something went wrong while signing in. Please try again in a moment.",
  ],
  suspended: [
    "정지된 계정이에요. team@endue.ai 로 문의해 주세요.",
    "This account is suspended. Write to team@endue.ai.",
  ],
  rejected: [
    "endue 가 세션 연장을 거절했어요. 지금은 로그인 상태를 유지해요.",
    "endue refused to renew the session. You stay signed in for now.",
  ],
  "session-expired": ["다시 로그인이 필요해요.", "Please sign in again."],
  failed: ["인증에 실패했습니다. 다시 시도해 주세요.", "Sign-in failed. Please try again."],
} as const;

export type AccountKey = keyof typeof copy;

export const accountText = (lang: Lang, key: AccountKey): string =>
  copy[key][lang === "ko" ? 0 : 1];

/**
 * What the person reads about `status`'s problem, in `lang`: the reason's line, a waiting line while
 * the code still holds, or the core's own sentence for a reason this runtime does not know.
 */
export function problemText(lang: Lang, status: AccountStatus): string | undefined {
  const { reason, problem, state } = status;
  if (!reason) return problem;
  if (state === "signing-in") {
    if (reason === "slow-down") return accountText(lang, "slowWaiting");
    if (reason === "offline" || reason === "unavailable") return accountText(lang, "stillWaiting");
  }
  return reason in copy ? accountText(lang, reason) : problem;
}
