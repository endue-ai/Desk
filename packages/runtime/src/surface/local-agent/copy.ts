/** Labels of the agent programs on this computer: the agent bar's group and each agent's screen. */
import type { Lang } from "../../shell/copy";

const copy = {
  group: ["로컬", "Local"],
  groupLabel: ["이 컴퓨터의 에이전트", "Agents on this computer"],
  idle: ["{name} · 이 컴퓨터", "{name} · on this computer"],
  working: ["{name} · 일하는 중", "{name} · working"],
  noProgram: [
    "프로그램을 찾지 못해 세션만 읽습니다",
    "Program not found: the desk reads its sessions only",
  ],
  importSessions: ["세션 가져오기", "Import sessions"],
  importArchive: ["아카이브 가져오기", "Import archive"],
  importing: ["가져오는 중…", "Importing…"],
  imported: [
    "{n}개를 데스크로 가져왔습니다 · {same}개는 그대로입니다",
    "Imported {n} into the desk · {same} already up to date",
  ],
  importFailedSome: ["{n}개는 읽지 못했습니다", "{n} could not be read"],
  importFailed: ["가져오지 못했습니다: {why}", "Could not import: {why}"],
  tabs: ["세션 목록", "Sessions"],
  tabLocal: ["세션 {n}", "Sessions {n}"],
  tabArchive: ["아카이브 {n}", "Archive {n}"],
  tabDesk: ["데스크 {n}", "In Desk {n}"],
  search: ["세션 찾기", "Find a session"],
  empty: ["세션이 없습니다", "No sessions"],
  emptyDesk: [
    "아직 가져온 세션이 없습니다. 위의 버튼으로 가져오세요.",
    "Nothing imported yet. Import with the buttons above.",
  ],
  more: ["더 보기 · {n}개 남음", "Show more · {n} left"],
  pick: [
    "세션을 고르면 대화가 보입니다. 아래에서 새 작업을 맡길 수 있습니다.",
    "Pick a session to read it. Below, hand the agent new work.",
  ],
  reading: ["읽는 중…", "Reading…"],
  readFailed: ["읽지 못했습니다: {why}", "Could not read it: {why}"],
  inDesk: ["데스크에 있음", "In Desk"],
  archived: ["아카이브", "Archived"],
  truncated: ["앞의 대화는 생략했습니다", "Earlier turns are left out"],
  you: ["나", "You"],
  tool: ["도구 · {name}", "Tool · {name}"],
  cut: ["…(잘림)", "…(cut)"],
  runs: ["맡긴 작업", "Work handed over"],
  running: ["하는 중", "Working"],
  done: ["끝남", "Done"],
  failed: ["실패", "Failed"],
  stopped: ["멈춤", "Stopped"],
  stop: ["멈추기", "Stop"],
  fromEris: ["Eris 가 맡김", "From Eris"],
  tools: ["도구 {n}번", "Tools {n}"],
  promptContinue: ["이 세션에 이어서 맡길 일", "Work to continue this session with"],
  promptNew: ["새 세션으로 맡길 일", "Work for a new session"],
  send: ["작업 요청", "Hand over"],
  sendHint: ["{key} 로 보내기", "{key} to send"],
  access: ["권한", "Access"],
  readOnly: ["읽기만", "Read only"],
  mayChange: ["편집 허용", "Allow edits"],
  mayChangeHint: [
    "에이전트가 자기 권한 설정대로 파일을 바꾸고 명령을 실행할 수 있습니다.",
    "The agent may change files and run commands as its own settings allow.",
  ],
  folder: ["작업 폴더", "Folder"],
  newSession: ["새 세션으로", "New session"],
  continuing: ["이어서: {title}", "Continuing: {title}"],
  askFailed: ["맡기지 못했습니다: {why}", "Could not hand it over: {why}"],
  justNow: ["방금", "just now"],
  minutesAgo: ["{n}분 전", "{n} min ago"],
  hoursAgo: ["{n}시간 전", "{n} h ago"],
  daysAgo: ["{n}일 전", "{n} d ago"],
} as const;

export type LocalCopyKey = keyof typeof copy;

export function localText(
  lang: Lang,
  key: LocalCopyKey,
  vars: Record<string, string | number> = {},
): string {
  const text: string = copy[key][lang === "ko" ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
