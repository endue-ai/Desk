// A small synthesizer for MIDI songs on Web Audio, rendered offline into a WAV the webview plays
// like any file (so the transport, seeking and speed work as for every other file): one oscillator
// per note with an envelope, the program's family choosing the waveform, and channel 10 as filtered
// noise bursts shaped by the drum.
import { encodeWav } from "./wav.js";

/**
 * @typedef {import("./midi.js").Song} Song
 * @typedef {import("./midi.js").Note} Note
 * @typedef {{ setValueAtTime(v: number, t: number): unknown, linearRampToValueAtTime(v: number, t: number): unknown,
 *   exponentialRampToValueAtTime(v: number, t: number): unknown, setTargetAtTime(v: number, t: number, c: number): unknown }} Param
 * @typedef {{ connect(node: unknown): unknown }} Node
 * @typedef {{ getChannelData(channel: number): Float32Array, length: number, sampleRate: number }} Buffer
 * @typedef {{
 *   destination: unknown,
 *   sampleRate: number,
 *   createOscillator(): Node & { type: string, frequency: Param, start(t: number): void, stop(t: number): void },
 *   createGain(): Node & { gain: Param },
 *   createBiquadFilter(): Node & { type: string, frequency: Param, Q: Param },
 *   createBuffer(channels: number, length: number, rate: number): Buffer,
 *   createBufferSource(): Node & { buffer: unknown, start(t: number): void, stop(t: number): void },
 *   startRendering(): Promise<Buffer>,
 * }} Context
 * @typedef {(channels: number, length: number, sampleRate: number) => Context} CreateContext
 */

/** The General MIDI program families (eight programs each) as oscillator waveforms. */
const FAMILIES = [
  "triangle", // piano
  "sine", // chromatic percussion
  "square", // organ
  "triangle", // guitar
  "triangle", // bass
  "sawtooth", // strings
  "sawtooth", // ensemble
  "sawtooth", // brass
  "square", // reed
  "sine", // pipe
  "square", // synth lead
  "sawtooth", // synth pad
  "triangle", // synth effects
  "triangle", // ethnic
  "sine", // percussive
  "sine", // sound effects
];
/** Families whose notes die away while held, as a plucked or struck sound does. */
const STRUCK = new Set([0, 1, 3, 14]);

/** @param {number} program */
export const waveFor = (program) => FAMILIES[(program >> 3) & 15] ?? "sine";

/** Each drum as a filter, its frequency and how long it rings. */
function drum(/** @type {number} */ key) {
  if (key === 35 || key === 36) return { type: "lowpass", hz: 160, decay: 0.25 };
  if (key === 38 || key === 40 || key === 37 || key === 39)
    return { type: "bandpass", hz: 1800, decay: 0.18 };
  if (key === 42 || key === 44) return { type: "highpass", hz: 7000, decay: 0.06 };
  if (key === 46) return { type: "highpass", hz: 7000, decay: 0.3 };
  if ([49, 51, 52, 53, 55, 57, 59].includes(key)) return { type: "highpass", hz: 5000, decay: 0.7 };
  if (key >= 41 && key <= 50) return { type: "lowpass", hz: 300 + (key - 41) * 60, decay: 0.3 };
  return { type: "bandpass", hz: 1000, decay: 0.15 };
}

const RELEASE = 0.3;

/**
 * Put every note on the context's timeline.
 * @param {Context} context
 * @param {Note[]} notes
 */
export function schedule(context, notes) {
  const out = context.createGain();
  out.gain.setValueAtTime(0.5, 0);
  out.connect(context.destination);
  const rate = context.sampleRate;
  const noise = context.createBuffer(1, Math.floor(rate / 2), rate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  for (const note of notes) {
    const peak = (note.velocity / 127) * 0.3;
    const gain = context.createGain();
    gain.connect(out);
    if (note.channel === 9) {
      const shape = drum(note.key);
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = shape.type;
      filter.frequency.setValueAtTime(shape.hz, note.start);
      source.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(peak * 1.5, note.start);
      gain.gain.exponentialRampToValueAtTime(0.0001, note.start + shape.decay);
      source.start(note.start);
      source.stop(note.start + shape.decay + 0.05);
      continue;
    }
    const wave = waveFor(note.program);
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(440 * 2 ** ((note.key - 69) / 12), note.start);
    oscillator.connect(gain);
    const level = wave === "sawtooth" || wave === "square" ? peak * 0.5 : peak;
    const held = Math.max(note.end, note.start + 0.02);
    gain.gain.setValueAtTime(0, note.start);
    gain.gain.linearRampToValueAtTime(level, note.start + 0.01);
    if (STRUCK.has((note.program >> 3) & 15)) gain.gain.setTargetAtTime(0, note.start + 0.01, 0.6);
    else gain.gain.setTargetAtTime(level * 0.7, note.start + 0.01, 0.1);
    gain.gain.setTargetAtTime(0, held, RELEASE / 4);
    oscillator.start(note.start);
    oscillator.stop(held + RELEASE);
  }
}

/**
 * Render a song into a mono 16-bit WAV. `limit` cuts very long songs, in seconds.
 * @param {Song} song
 * @param {CreateContext} create makes the OfflineAudioContext (a stand-in in tests)
 * @param {{ sampleRate?: number, limit?: number }} [options]
 * @returns {Promise<{ wav: Uint8Array, duration: number, cut: boolean }>}
 */
export async function render(song, create, options = {}) {
  const rate = options.sampleRate ?? 32000;
  const limit = options.limit ?? 20 * 60;
  const cut = song.duration > limit;
  const seconds = Math.min(song.duration, limit) + RELEASE;
  const context = create(1, Math.ceil(seconds * rate), rate);
  schedule(context, cut ? song.notes.filter((n) => n.start < limit) : song.notes);
  const buffer = await context.startRendering();
  const samples = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  if (peak > 0.95)
    for (let i = 0; i < samples.length; i++) samples[i] = ((samples[i] ?? 0) * 0.95) / peak;
  return {
    wav: encodeWav([samples], buffer.sampleRate),
    duration: buffer.length / buffer.sampleRate,
    cut,
  };
}
