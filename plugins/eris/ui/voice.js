// Eris's voice: a female English voice from the system's speech synthesis. The soul text keeps its
// own timing (the script, or wordsFromText); a TTS with word timestamps replaces this voice later.

/** System voices that are female, best first (macOS, Windows, Chrome). The Web Speech API has no gender. */
export const FEMALE = [
  "Samantha",
  "Ava",
  "Allison",
  "Susan",
  "Zoe",
  "Karen",
  "Moira",
  "Tessa",
  "Serena",
  "Victoria",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Microsoft Zira",
  "Google US English",
];

/** A female English voice, or null: then Eris only shows her words, she never borrows another voice. */
export function pickVoice(voices) {
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang));
  for (const name of FEMALE) {
    const voice = english.find((candidate) => candidate.name.startsWith(name));
    if (voice) return voice;
  }
  return english.find((voice) => /female/i.test(voice.name)) ?? null;
}

const SILENT = { speak() {}, cancel() {} };

/**
 * `speak(text)` says one sentence; `cancel()` stops whatever is being said. Automated browsers stay
 * silent (tests must not talk), and so does a system without a female English voice.
 */
export function createVoice(win) {
  const synth = win.speechSynthesis;
  if (!synth || !win.SpeechSynthesisUtterance || win.navigator.webdriver) return SILENT;
  synth.getVoices(); // the list fills in asynchronously; asking early starts loading it
  return {
    speak(text) {
      const voice = pickVoice(synth.getVoices());
      if (!voice || !text) return;
      const utterance = new win.SpeechSynthesisUtterance(
        text.replaceAll("E.R.I.S.", "E. R. I. S."),
      );
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 1;
      utterance.pitch = 1.05;
      synth.speak(utterance);
    },
    cancel() {
      synth.cancel();
    },
  };
}
