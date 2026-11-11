/**
 * Settings › Keyboard's conflicts in a person's words (#158 finding 16): which shortcut does not run
 * as it is set, why, and who set it (you, the desk, or a plugin by its name), never a file path or a
 * command's id. `desk.keys.conflicts` and `desk settings lint` keep the developer's lines with their
 * sources (`sequences/report.ts`).
 */
import type { Platform } from "../sequences/chord";
import type { Conflict, Resolved } from "../sequences/conflicts";
import { keyNodes } from "../sequences/keyboard-parts";
import { formatSequence } from "../sequences/parse";
import type { Reserved } from "../sequences/reserved";
import { h } from "../shell/dom";
import type { SettingsLanguage } from "./copy";

export interface ConflictWords {
  platform: Platform;
  language: SettingsLanguage;
  /** A command's title; undefined when no such command is there now. */
  title(command: string): string | undefined;
  /** A plugin's name, by its id. */
  plugin(id: string): string;
}

const COPY = {
  heading: ["단축키 충돌", "Shortcut conflicts"],
  intro: [
    "아래 단축키는 지정한 대로 실행되지 않습니다.",
    "These shortcuts do not run as they are set.",
  ],
  taken: ["다른 단축키가 대신 쓰는 키", "Taken over by another shortcut"],
  you: ["직접 지정", "Set by you"],
  desk: ["기본 제공", "Built in"],
  plugin: ["플러그인: ", "Set by "],
  absent: ["지금은 쓸 수 없는 명령", "A command not available now"],
  another: ["이 명령에 다른 키를 지정하세요.", "Give this command another key."],
  offThere: [
    "시스템 설정에서 그 단축키를 끄거나 이 명령에 다른 키를 지정하세요.",
    "Turn that shortcut off in the system's settings, or give this command another key.",
  ],
} as const;
type Copy = keyof typeof COPY;

/** Who keeps a reserved chord, as the subject of a sentence. */
const HOLDER: Record<Reserved["by"], [string, string]> = {
  macOS: ["macOS가", "macOS uses"],
  "Windows and Linux": ["Windows와 Linux가", "Windows and Linux use"],
  "the desk": ["Desk가", "Desk uses"],
};
/** What the system does with a reserved chord, in Korean; English reads `Reserved.does` as is. */
const DOES_KO: Record<string, string> = {
  "quits Desk": "Desk를 종료합니다",
  "hides Desk": "Desk를 가립니다",
  "hides the other apps": "다른 앱을 가립니다",
  "minimizes the window": "창을 최소화합니다",
  "switches apps": "앱을 전환합니다",
  "switches the app's windows": "앱의 창을 전환합니다",
  "opens Spotlight": "Spotlight를 엽니다",
  "force-quits apps": "앱을 강제 종료합니다",
  "locks the screen": "화면을 잠급니다",
  "takes a screenshot": "스크린샷을 찍습니다",
  "switches windows": "창을 전환합니다",
  "closes the window": "창을 닫습니다",
  "opens the security screen": "보안 화면을 엽니다",
  "shows the desktop": "바탕 화면을 보여 줍니다",
  "opens the palette from any app": "어느 앱에서든 팔레트를 엽니다",
  "cancels a pending prefix": "입력 중인 키를 취소합니다",
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The conflicts a person is shown: a key that two layers give the same command loses nothing. */
export function shownConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter(
    ({ kind, binding, by }) =>
      !(kind === "duplicate" && by?.command === binding.command && same(by.args, binding.args)),
  );
}

/** Why `conflict` keeps its key from running, as one or two sentences. */
export function conflictReason(conflict: Conflict, words: ConflictWords): string {
  const ko = words.language === "ko";
  const tr = (key: Copy) => COPY[key][ko ? 0 : 1];
  const keys = (b: Resolved) => formatSequence(b.combo, words.platform);
  const { binding, by, reserved } = conflict;
  if (conflict.kind === "reserved" && reserved) {
    const chord = formatSequence(reserved.chord, words.platform);
    const does = ko ? (DOES_KO[reserved.does] ?? reserved.does) : reserved.does;
    if (reserved.never)
      return ko
        ? `이 키는 실행될 수 없습니다. ${chord} 키가 ${does}. ${tr("another")}`
        : `It can never run: ${chord} ${does}. ${tr("another")}`;
    const [holderKo, holderEn] = HOLDER[reserved.by];
    const fix = reserved.by === "the desk" ? tr("another") : tr("offThere");
    return ko ? `${holderKo} 이 키로 ${does}. ${fix}` : `${holderEn} this key: it ${does}. ${fix}`;
  }
  if (!by) return "";
  const other = `“${name(by.command, words)}”`;
  if (conflict.kind === "duplicate")
    return ko
      ? `같은 키가 ${other}에도 지정되어 그 명령이 대신 실행됩니다 (${who(by, words)}).`
      : `${other} has this key too and runs instead (${lower(who(by, words))}).`;
  if (binding.chords.length > by.chords.length)
    return ko
      ? `${keys(by)} 키가 먼저 ${other} 명령을 실행해서 이 키는 끝까지 누를 수 없습니다.`
      : `${keys(by)} runs ${other} first, so this key can never be finished.`;
  return ko
    ? `${keys(by)} 키가 이 키로 시작해서, 이 키를 누르면 다음 키를 기다리기만 합니다.`
    : `${keys(by)} starts with this key, so pressing it only waits for the next key.`;
}

/** A command's title, or what it is when it is not there now. */
function name(command: string, words: ConflictWords): string {
  return words.title(command) ?? COPY.absent[words.language === "ko" ? 0 : 1];
}

/** Who set a binding: you, the desk itself, or a plugin by its name. */
export function who(binding: Resolved, words: ConflictWords): string {
  const at = words.language === "ko" ? 0 : 1;
  if (binding.layer === "personal") return COPY.you[at];
  if (binding.layer === "default") return COPY.desk[at];
  const plugin = words.plugin(binding.owner);
  return words.language === "ko" ? `${COPY.plugin[0]}${plugin}` : `${COPY.plugin[1]}${plugin}`;
}

/** Every conflict a person should know of; the keys a later layer took over under a disclosure. */
export function conflictsPanel(conflicts: Conflict[], words: ConflictWords): HTMLElement | null {
  const shown = shownConflicts(conflicts);
  if (!shown.length) return null;
  const tr = (key: Copy) => COPY[key][words.language === "ko" ? 0 : 1];
  const item = (conflict: Conflict) =>
    h(
      "li",
      {
        class: `settings-key-row keys-conflict is-${conflict.severity}`,
        "data-conflict": conflict.kind,
        "data-combo": conflict.binding.combo,
      },
      h(
        "span",
        { class: "settings-key-label" },
        h("strong", {}, name(conflict.binding.command, words)),
        h("span", { class: "keys-conflict-why" }, conflictReason(conflict, words)),
        h("small", {}, who(conflict.binding, words)),
      ),
      h(
        "span",
        { class: "settings-key-combo" },
        ...keyNodes(conflict.binding.combo, words.platform),
      ),
    );
  const serious = shown.filter((c) => c.severity !== "info");
  const settled = shown.filter((c) => c.severity === "info");
  return h(
    "section",
    { class: "keys-conflicts", "aria-label": tr("heading") },
    serious.length
      ? [
          h("h2", { class: "settings-key-note" }, `${tr("heading")} (${serious.length})`),
          h("p", { class: "settings-key-note" }, tr("intro")),
          h("ul", { class: "settings-key-list" }, serious.map(item)),
        ]
      : null,
    settled.length
      ? h(
          "details",
          { class: "keys-conflicts-settled" },
          h("summary", {}, `${tr("taken")} (${settled.length})`),
          h("ul", { class: "settings-key-list" }, settled.map(item)),
        )
      : null,
  );
}
