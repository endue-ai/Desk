/**
 * Eris's mouth: one pulse per syllable (the mesh's rule for her voice) and the platform's speech
 * synthesis. Without timestamps per syllable, each word's time is shared evenly by its syllables.
 */
import type { WordTime } from "../bridge/types";
import type { Speech, TalkLang } from "./talk";

const HANGUL = /[가-힣]/g;
const VOWELS = /[aeiouyàáâäèéêëìíîïòóôöùúûü]+/gi;

/** Syllables in a word: each Hangul block is one, Latin words count vowel groups; at least one. */
export function syllables(word: string): number {
  const hangul = word.match(HANGUL)?.length ?? 0;
  const latin = word.replace(HANGUL, " ").match(VOWELS)?.length ?? 0;
  return Math.max(1, hangul + latin);
}

/**
 * Pulse times (ms after the line starts): each word's syllables spread over the time until the next
 * word, or over its letters at `msPerChar` for the last one.
 */
export function syllablePulses(words: readonly WordTime[], msPerChar: number): number[] {
  const out: number[] = [];
  words.forEach((w, i) => {
    const next = words[i + 1];
    const span = next ? Math.max(0, next.at - w.at) : w.word.length * msPerChar;
    const n = syllables(w.word);
    for (let k = 0; k < n; k++) out.push(Math.round(w.at + (k * span * 0.9) / n));
  });
  return out;
}

const LOCALE: Record<TalkLang, string> = { ko: "ko-KR", en: "en-US" };

/** Say `text` with the platform's speech synthesis; null when the page has none. */
export function speakAloud(text: string, lang: TalkLang): Speech | null {
  const synth = typeof speechSynthesis === "undefined" ? undefined : speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LOCALE[lang];
  const voice = synth.getVoices().find((v) => v.lang.replace("_", "-").startsWith(LOCALE[lang]));
  if (voice) utterance.voice = voice;
  const done = new Promise<void>((resolve) => {
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
  });
  synth.cancel();
  synth.speak(utterance);
  return {
    done,
    stop: () => synth.cancel(),
  };
}
