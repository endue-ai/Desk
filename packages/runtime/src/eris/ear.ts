/**
 * Eris's ear for a spoken turn: the microphone through Web Audio (an AnalyserNode, fftSize 256, into
 * the nine sound bands) plus the platform's speech recognition when the page has it, or a recorded
 * sample voice replayed on the shell's clock when there is no microphone.
 */
import { type Envelope, sampleEnvelope } from "../bridge/browser";
import type { Bands } from "../bridge/types";
import type { Ear, TalkLang } from "./talk";
import { bandsFromSpectrum } from "./voice";

/** The analyser's byte range in dBFS: a quiet room reads 0, a near voice about two thirds. */
const MIN_DB = -90;
const MAX_DB = -25;
/** After asking recognition to stop, its final words are awaited this long. */
const FINAL_WORDS_MS = 900;
const LOCALE: Record<TalkLang, string> = { ko: "ko-KR", en: "en-US" };

/**
 * An AudioContext made inside the click, so the page lets it run; undefined without Web Audio or
 * without a microphone to feed it (no audio machinery is started for nothing).
 */
export function audioContext(): AudioContext | undefined {
  if (typeof AudioContext === "undefined") return undefined;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return undefined;
  try {
    return new AudioContext();
  } catch {
    return undefined;
  }
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The platform's speech recognition, listening in `lang`; null when the page has none. */
function recognise(lang: TalkLang): { stop(): Promise<string> } | null {
  const w = globalThis as unknown as Record<string, (new () => Recognition) | undefined>;
  const Make = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Make) return null;
  let text = "";
  let ended = false;
  let finish: (() => void) | undefined;
  try {
    const r = new Make();
    r.lang = LOCALE[lang];
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      text = Array.from(e.results, (alt) => alt[0]?.transcript ?? "").join(" ");
    };
    r.onerror = () => {};
    r.onend = () => {
      ended = true;
      finish?.();
    };
    r.start();
    return {
      stop: () =>
        new Promise<string>((resolve) => {
          finish = () => resolve(text.trim());
          if (ended) return finish();
          setTimeout(finish, FINAL_WORDS_MS);
          try {
            r.stop();
          } catch {
            finish();
          }
        }),
    };
  } catch {
    return null;
  }
}

/** The microphone; null when there is none, it was refused, or Web Audio is missing. */
export async function openMic(
  lang: TalkLang,
  audio: AudioContext | undefined,
): Promise<Ear | null> {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!audio || !devices?.getUserMedia) {
    void audio?.close();
    return null;
  }
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    void audio.close();
    return null;
  }
  void audio.resume().catch(() => {});
  const analyser = audio.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0;
  analyser.minDecibels = MIN_DB;
  analyser.maxDecibels = MAX_DB;
  audio.createMediaStreamSource(stream).connect(analyser);
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const words = recognise(lang);
  let closed = false;
  return {
    live: true,
    bands() {
      if (closed) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
      analyser.getByteFrequencyData(bins);
      return bandsFromSpectrum(bins, audio.sampleRate);
    },
    async close() {
      if (closed) return "";
      closed = true;
      for (const track of stream.getTracks()) track.stop();
      void audio.close().catch(() => {});
      return (await words?.stop()) ?? "";
    },
  };
}

/** The recorded sample voice, replayed from `at` on the shell's clock; nothing is recognised. */
export function sampleEar(envelope: Envelope, at: number): Ear {
  return {
    live: false,
    bands: (now: number): Bands => sampleEnvelope(envelope, now - at),
    close: async () => "",
  };
}
