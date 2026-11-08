// The first run's sounds, made with Web Audio: a low hum that grows and spreads, a tick per count, a
// breath, a click per polygon and one chime. The cues come from the first-run timeline, so sound and
// picture follow the same clock. Automated browsers stay silent.

const SILENT = { hum() {}, tick() {}, breath() {}, click() {}, chime() {}, stop() {} };

export function createSound(win) {
  const Context = win.AudioContext ?? win.webkitAudioContext;
  if (!Context || win.navigator.webdriver) return SILENT;
  let ctx = null;
  let master = null;
  const audio = () => {
    if (!ctx) {
      ctx = new Context();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  /** One sine (or triangle) note with an attack and an exponential release. */
  const note = (
    frequency,
    { at = 0, attack = 0.005, length = 0.08, level = 0.2, type = "sine" },
  ) => {
    const c = audio();
    const start = c.currentTime + at;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + length);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + attack + length + 0.05);
  };

  return {
    /** Scene 1's low hum: it grows over the warp (0-2 s), spreads at 3.5 s and fades by 8 s. */
    hum() {
      const c = audio();
      const now = c.currentTime;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(220, now);
      filter.frequency.linearRampToValueAtTime(260, now + 3.5);
      filter.frequency.exponentialRampToValueAtTime(1400, now + 5);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 2);
      gain.gain.linearRampToValueAtTime(0.14, now + 5);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 8);
      filter.connect(gain).connect(master);
      for (const [frequency, detune] of [
        [55, 0],
        [110, 4],
        [82.5, -6],
      ]) {
        const osc = c.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(now);
        osc.stop(now + 8.1);
      }
    },
    tick() {
      note(1320, { length: 0.04, level: 0.12, type: "triangle" });
    },
    /** Breathing in: filtered noise that swells for a second as the beam comes down. */
    breath() {
      const c = audio();
      const now = c.currentTime;
      const buffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 7;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] = seed / 1073741823.5 - 1;
      }
      const noise = c.createBufferSource();
      noise.buffer = buffer;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(500, now);
      band.frequency.linearRampToValueAtTime(1600, now + 1);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1);
      noise.connect(band).connect(gain).connect(master);
      noise.start(now);
    },
    click() {
      note(2400, { length: 0.02, level: 0.06, type: "triangle" });
    },
    /** The gold face locks in: a small bell. */
    chime() {
      for (const [frequency, level, length] of [
        [880, 0.16, 2.4],
        [1760, 0.07, 1.6],
        [2637, 0.04, 1.1],
        [3520, 0.02, 0.8],
      ]) {
        note(frequency, { attack: 0.004, length, level });
      }
    },
    stop() {
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
  };
}
