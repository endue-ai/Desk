/** The words of key sequences: the which-key overlay, the pending indicator and Settings › Keyboard. */
export type SequenceLanguage = "ko" | "en";

const copy = {
  after: ["다음 키", "Keys after"],
  describing: ["설명할 키", "Describe the key after"],
  search: ["검색하거나 다음 키를 누르세요", "Type to search, or press the next key"],
  continuations: ["이어지는 키", "Continuations"],
  nothing: ["일치하는 키가 없습니다", "Nothing matches"],
  help: ["↑↓ 선택 · ↩ 실행 · ⌫ 뒤로 · Esc 취소", "↑↓ choose · ↩ run · ⌫ back · Esc cancel"],
  off: ["지금은 쓸 수 없음", "not available now"],
  you: ["나", "you"],
  desk: ["데스크", "desk"],
  waiting: ["다음 키를 기다리는 중:", "Waiting for the key after"],
  unbound: ["에 연결된 명령이 없습니다", "is not bound"],
  offNow: ["의 명령은 지금 쓸 수 없습니다", "runs a command that is not available now"],
  timeout: ["시간이 지나 취소됨", "waited too long and was cancelled"],
  quit: ["취소됨", "Quit"],
  recordKeys: [
    "키를 차례로 누른 뒤 Enter · ⌫ 마지막 키 지우기 · Esc 취소",
    "Press the keys one after another, then Enter · Backspace takes the last back · Esc cancels",
  ],
  enterToSave: ["Enter로 저장", "Enter to save"],
  nextKey: ["다음 키를 누르세요 · Enter로 저장", "Press the next key · Enter to save"],
  several: [
    "여러 키를 차례로 기록 (Ctrl+X Ctrl+F)",
    "Record several keys in a row (Ctrl+X Ctrl+F)",
  ],
  save: ["저장", "Save"],
  never: ["이 키는 실행될 수 없습니다:", "This key can never run:"],
  reservedAsk: ["시스템이 쓰는 키가 들어 있습니다:", "The system keeps a chord of this key:"],
  shadowAsk: ["이 키는 다음 단축키를 가립니다:", "This key would take these shortcuts away:"],
  bindAnyway: ["그래도 지정", "Bind Anyway"],
  shadowed: ["앞뒤가 겹치는 단축키를 정리했습니다.", "Shortcuts one prefix away were cleared."],
  timeoutLabel: ["다음 키 기다리기", "Wait for the next key"],
  timeoutHint: [
    "Mod+K Mod+S처럼 이어지는 단축키에서 첫 키 다음을 기다리는 시간",
    "How long a prefix such as Mod+K of Mod+K Mod+S waits",
  ],
  forever: ["제한 없음", "As long as it takes"],
} as const;

export type SequenceCopy = keyof typeof copy;

export const sequenceText = (lang: SequenceLanguage, key: SequenceCopy): string =>
  copy[key][lang === "ko" ? 0 : 1];

/** The choices of desk.keys.sequence-timeout, in milliseconds (0: no limit). */
export const TIMEOUTS = [0, 1000, 1500, 3000] as const;

/** A timeout as people read it: "1.5 s"; 0 is "As long as it takes". */
export function timeoutText(lang: SequenceLanguage, ms: number): string {
  if (ms <= 0) return sequenceText(lang, "forever");
  const seconds = ms / 1000;
  return lang === "ko" ? `${seconds}초` : `${seconds} s`;
}
