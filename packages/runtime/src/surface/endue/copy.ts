/** Words of the person's endue agents and spaces: the agent bar's buttons and their windows' cards. */
import type { Lang } from "../../shell/copy";

const copy = {
  // The agent bar.
  barAgent: ["{name} · {presence}", "{name} · {presence}"],
  barSpace: ["{name} 스페이스", "{name} space"],
  barLoading: ["endue 에서 읽는 중", "Reading from endue"],
  barOffline: ["endue 에 닿지 않습니다", "endue can't be reached"],
  moreAgents: ["에이전트 {n}개 더", "{n} more agents"],
  // Presence.
  working: ["일하는 중", "Working"],
  waiting: ["확인이 필요해요", "Needs you"],
  online: ["온라인", "Online"],
  paused: ["꺼짐", "Paused"],
  offline: ["오프라인", "Offline"],
  // Both cards.
  badge: ["endue", "endue"],
  spaceBadge: ["스페이스", "Space"],
  studio: ["스튜디오", "Studio"],
  studioHint: ["카드를 뒤집어 상태를 봅니다", "Turn the card over to see its status"],
  backToCard: ["카드로", "Card"],
  backHint: ["카드 앞면으로 돌아갑니다", "Turn the card back to its front"],
  openWeb: ["endue.ai 에서 열기", "Open in endue.ai"],
  refresh: ["다시 읽기", "Read again"],
  reading: ["읽는 중…", "Reading…"],
  readFailed: ["읽지 못했습니다: {why}", "Could not read it: {why}"],
  signedOut: ["로그인하면 다시 보입니다", "Sign in to see it again"],
  gone: ["endue 에서 찾을 수 없습니다", "endue no longer has it"],
  none: ["없음", "None"],
  studioTitle: ["스튜디오 · 상태", "Studio · Status"],
  created: ["만든 날", "Created"],
  updated: ["바뀐 날", "Updated"],
  lastActivity: ["마지막 활동", "Last activity"],
  notAnswered: ["endue AI 가 답하지 않았습니다", "endue AI did not answer"],
  // An agent's card.
  noDescription: ["소개가 아직 없습니다", "No description yet"],
  skillsChip: ["스킬 · {n}", "Skills · {n}"],
  connectorsChip: ["커넥터 · {n}", "Connectors · {n}"],
  // An agent's Studio.
  status: ["상태", "Status"],
  statusActive: ["켜짐", "Active"],
  statusInactive: ["꺼짐", "Disabled"],
  statusArchived: ["보관됨", "Archived"],
  rightNow: ["지금", "Right now"],
  model: ["채팅 모델", "Chat model"],
  modelDefault: ["endue AI 기본 모델", "endue AI's model"],
  visibility: ["공개 범위", "Visibility"],
  public: ["공개", "Public"],
  unlisted: ["링크로만", "Unlisted"],
  private: ["비공개", "Private"],
  prompt: ["프롬프트", "Prompt"],
  promptRev: ["{n}번째 판", "Revision {n}"],
  skills: ["스킬", "Skills"],
  onOf: ["{n}개 중 {on}개 켜짐", "{on} of {n} on"],
  connectors: ["커넥터", "Connectors"],
  count: ["{n}개", "{n}"],
  traits: ["특성", "Traits"],
  traitsOn: ["{n}개 켜짐", "{n} on"],
  languages: ["언어", "Languages"],
  conversations: ["대화", "Conversations"],
  conversationCounts: [
    "진행 {active} · 대기 {waiting} · 실패 {failed} · 완료 {done}",
    "{active} active · {waiting} waiting · {failed} failed · {done} done",
  ],
  // A space's card.
  noGoal: ["목표가 아직 없습니다", "No goal yet"],
  frontDesk: ["창구 · {name}", "Front desk · {name}"],
  agentsChip: ["에이전트 · {n}", "Agents · {n}"],
  inProgress: ["진행 중 · {n}", "In progress · {n}"],
  needsYou: ["확인 필요 · {n}", "Needs you · {n}"],
  latest: ["최근 결과 · {title}", "Latest · {title}"],
  someoneElse: ["다른 사람의 에이전트", "Someone else's agent"],
  // A space's Studio.
  statusSpaceActive: ["사용 중", "Active"],
  workInProgress: ["진행 중인 일", "Work in progress"],
  waitingForYou: ["확인이 필요한 일", "Waiting for you"],
  results: ["결과", "Results"],
  agents: ["참여 에이전트", "Agents"],
  rooms: ["룸", "Rooms"],
  roomsLine: [
    "{n}개 · 읽지 않음 {unread} · 토론 중 {live}",
    "{n} · {unread} unread · {live} discussing",
  ],
  goingOn: ["진행 중", "Going on"],
  newest: ["최근 결과", "Newest results"],
  roomsList: ["룸", "Rooms"],
  unread: ["읽지 않음 {n}", "{n} unread"],
  discussing: ["토론 중", "Discussing"],
  admin: ["운영", "Runs it"],
  participant: ["참여", "Takes part"],
  front: ["창구", "Front"],
  partOverview: ["개요", "Overview"],
  partRooms: ["룸", "Rooms"],
  partFailed: ["{part}: {why}", "{part}: {why}"],
  // How a piece of work stands.
  queued: ["대기", "Queued"],
  preparing: ["준비 중", "Preparing"],
  in_progress: ["진행 중", "In progress"],
  needs_you: ["확인 필요", "Needs you"],
  stopping: ["멈추는 중", "Stopping"],
  pausing: ["쉬는 중", "Pausing"],
  // "paused" is presence's word above; work uses the same.
  done: ["완료", "Done"],
  partly_done: ["일부 완료", "Partly done"],
  failed: ["실패", "Failed"],
  stopped: ["멈춤", "Stopped"],
} satisfies Record<string, [string, string]>;

export type EndueKey = keyof typeof copy;

export function endueText(
  lang: Lang,
  key: EndueKey,
  vars: Record<string, string | number> = {},
): string {
  const [ko, en] = copy[key];
  return (lang === "ko" ? ko : en).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? ""),
  );
}
