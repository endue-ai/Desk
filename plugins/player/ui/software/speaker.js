// The software player's sound: decoded chunks as AudioBuffers, each started at the context time the
// clock names, through one GainNode for volume and mute. Thin on purpose: the element decides what
// plays when, and the tests give it a fake context.

/**
 * @typedef {{ sampleRate: number, channels: Float32Array[] }} Pcm
 * @typedef {{ stop(): void }} Playing
 * @typedef {{
 *   running(): boolean,
 *   time(): number,
 *   resume(): Promise<void>,
 *   buffer(pcm: Pcm): AudioBuffer | null,
 *   play(buffer: AudioBuffer, when: number, rate: number): Playing | null,
 *   volume(value: number): void,
 *   close(): void,
 * }} Speaker
 */

/** @param {AudioContext} context */
export function createSpeaker(context) {
  const gain = context.createGain();
  gain.connect(context.destination);
  // What the listener hears lags what the context renders by its output latency.
  const latency = () => {
    const value = /** @type {{ outputLatency?: number }} */ (context).outputLatency;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };

  /** @type {Speaker} */
  const speaker = {
    running: () => context.state === "running",
    time: () => context.currentTime - latency(),
    resume: async () => {
      try {
        await context.resume();
      } catch {
        // A context that will not start leaves the clock on the wall: the pictures still play.
      }
    },
    buffer(pcm) {
      const length = pcm.channels[0]?.length ?? 0;
      if (length === 0 || pcm.channels.length === 0) return null;
      try {
        const buffer = context.createBuffer(pcm.channels.length, length, pcm.sampleRate);
        pcm.channels.forEach((samples, i) => {
          buffer.copyToChannel(samples, i);
        });
        return buffer;
      } catch {
        // A rate the context refuses: that chunk is silent, the rest plays.
        return null;
      }
    },
    play(buffer, when, rate) {
      // A start in the past plays at once from the part that is due now.
      const now = context.currentTime;
      const at = Math.max(when, now);
      const offset = (at - when) * rate;
      if (offset >= buffer.duration) return null;
      const source = context.createBufferSource();
      source.buffer = buffer;
      // The rate changes the pitch too: Web Audio has no time stretching.
      source.playbackRate.value = rate;
      source.connect(gain);
      source.start(at, offset);
      return {
        stop() {
          try {
            source.stop();
          } catch {
            // Already ended.
          }
          source.disconnect();
        },
      };
    },
    volume(value) {
      gain.gain.value = value;
    },
    close() {
      gain.disconnect();
      try {
        void Promise.resolve(context.close()).catch(() => {});
      } catch {
        // Closed already.
      }
    },
  };
  return speaker;
}

/**
 * A speaker on a new context from `create`; null without Web Audio (the pictures then play on the
 * wall clock).
 * @param {(() => AudioContext) | undefined} create
 */
export function openSpeaker(create) {
  if (!create) return null;
  try {
    return createSpeaker(create());
  } catch {
    return null;
  }
}
