/**
 * Eris's ear through the bridge's microphone (audio.capture, ADR 0245), for a page without speech
 * recognition, as inside CEF: the latest 20 ms frame goes through the same analysis as the Web Audio
 * path (a 256-point spectrum in dBFS, MIN_DB..MAX_DB, into the nine sound bands), so she shows the
 * input level while she listens. Nothing turns speech into text yet: the ear hears no words.
 */
import type { Bands, ShellBridge } from "../bridge/types";
import type { Ear } from "./talk";
import { bandsFromSpectrum } from "./voice";

/** The analyser's byte range in dBFS: a quiet room reads 0, a near voice about two thirds. */
export const MIN_DB = -90;
export const MAX_DB = -25;
const SIZE = 256;
const SILENT: Bands = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);

/** A Hann window, as the analyser applies (Blackman there; the bands cannot tell). */
const WINDOW = Float64Array.from(
  { length: SIZE },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)),
);

/** The analyser's byte spectrum of the last SIZE samples: `getByteFrequencyData` for LINEAR16. */
export function spectrumOf(samples: Int16Array): Uint8Array {
  const bins = new Uint8Array(SIZE / 2);
  const start = Math.max(0, samples.length - SIZE);
  const x = Float64Array.from(
    { length: SIZE },
    (_, i) => ((samples[start + i] ?? 0) / 32768) * (WINDOW[i] ?? 0),
  );
  for (let k = 0; k < bins.length; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < SIZE; n++) {
      const angle = (2 * Math.PI * k * n) / SIZE;
      re += (x[n] ?? 0) * Math.cos(angle);
      im -= (x[n] ?? 0) * Math.sin(angle);
    }
    const magnitude = Math.hypot(re, im) / SIZE;
    const db = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity;
    bins[k] = Math.round(Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB))) * 255);
  }
  return bins;
}

/** The ear over `capture`; null when the person or the OS refused, or there is no microphone. */
export async function captureEar(
  capture: NonNullable<ShellBridge["audio"]["capture"]>,
): Promise<Ear | null> {
  let latest: Bands = SILENT;
  let closed = false;
  const mic = await capture((frame) => {
    if (!closed) latest = bandsFromSpectrum(spectrumOf(frame.samples), frame.sampleRate);
  }).catch(() => null);
  if (!mic) return null;
  return {
    live: true,
    bands: () => (closed ? SILENT : latest),
    async close() {
      if (closed) return "";
      closed = true;
      await mic.stop();
      return "";
    },
  };
}
