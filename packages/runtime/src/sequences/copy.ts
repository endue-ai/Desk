/** The words of key sequences: the which-key overlay, the pending indicator and Settings › Keyboard. */
import { type KeyOf, moduleText } from "../i18n/messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

export type SequenceLanguage = "ko" | "en";

const text = moduleText("sequences", { en, ko });

export type SequenceCopy = KeyOf<keyof typeof en, "sequences">;

export const sequenceText = (lang: SequenceLanguage, key: SequenceCopy): string => text(lang, key);

/** The choices of desk.keys.sequence-timeout, in milliseconds (0: no limit). */
export const TIMEOUTS = [0, 1000, 1500, 3000] as const;

/** A timeout as people read it: "1.5 s"; 0 is "As long as it takes". */
export function timeoutText(lang: SequenceLanguage, ms: number): string {
  if (ms <= 0) return sequenceText(lang, "forever");
  return text(lang, "seconds", { seconds: ms / 1000 });
}
