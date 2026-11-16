// Wi-Fi channel congestion (NET-12, NET-13), from the networks heard around this computer. Each
// network occupies the 20 MHz channels its width covers: on 2.4 GHz a channel's neighbours overlap
// it (5 MHz apart, 20 MHz wide), on 5 and 6 GHz a 40, 80 or 160 MHz network fills its aligned block.
// A channel's load is the sum, over the networks, of how much of the channel each covers times how
// loud it is; the recommendation is the least loaded of the channels people pick.

/**
 * @typedef {import("./wifi.js").Band} Band
 * @typedef {import("./wifi.js").Heard} Heard
 * @typedef {"free" | "busy" | "crowded"} Level
 * @typedef {{ channel: number, load: number, level: Level, count: number }} Lane
 * @typedef {Heard & { from: number, to: number, current?: boolean }} Placed
 * @typedef {{ band: Band, lanes: Lane[], networks: Placed[], recommended: number | null,
 *   current: Placed | null, verdict: { key: string, params: Record<string, string | number> } }} BandModel
 */

/** The 20 MHz channels drawn per band (Korea's and most of the world's 2.4 GHz plan: 1–13). */
export const CHANNELS = Object.freeze({
  2.4: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
  5: Object.freeze([
    36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149,
    153, 157, 161, 165,
  ]),
  6: Object.freeze(Array.from({ length: 59 }, (_, i) => 1 + 4 * i)),
});

/** The channels a recommendation picks from: 1, 6 and 11 never overlap; 5 GHz leaves out DFS. */
export const CANDIDATES = Object.freeze({
  2.4: Object.freeze([1, 6, 11]),
  5: Object.freeze([36, 40, 44, 48, 149, 153, 157, 161]),
  6: Object.freeze([5, 21, 37, 53, 69, 85, 101, 117, 133, 149, 165, 181, 197, 213, 229]),
});

/** A load below this is free; at or above CROWDED, crowded. */
export const BUSY = 1;
export const CROWDED = 2.5;

/** How loud a network is, 0.2 to 1, from its signal (−90 dBm faint, −50 dBm loud); 0.6 unknown. @param {number | null} rssi */
export function weightOf(rssi) {
  if (rssi === null) return 0.6;
  return Math.min(1, Math.max(0.2, (rssi + 90) / 40));
}

/** @param {number} load @returns {Level} */
export function levelOf(load) {
  return load >= CROWDED ? "crowded" : load >= BUSY ? "busy" : "free";
}

/**
 * The first and last 20 MHz channel a network covers. On 5 GHz the blocks start at 36, 100 and 149;
 * on 6 GHz at 1; on 2.4 GHz a 40 MHz network is drawn centred on its primary channel.
 * @param {Heard} n @returns {[number, number]}
 */
export function spanOf(n) {
  const units = Math.max(1, Math.round(n.width / 20));
  if (n.band === "2.4")
    return units > 1
      ? [Math.max(1, n.channel - 2), Math.min(13, n.channel + 2)]
      : [n.channel, n.channel];
  if (units === 1) return [n.channel, n.channel];
  const base = n.band === "6" ? 1 : n.channel >= 149 ? 149 : n.channel >= 100 ? 100 : 36;
  const index = Math.floor((n.channel - base) / 4);
  const start = base + 4 * (Math.floor(index / units) * units);
  return [start, start + 4 * (units - 1)];
}

/** How much of 20 MHz channel `k` a network spanning [from, to] covers, 0 to 1. @param {Band} band @param {number} from @param {number} to @param {number} k */
function cover(band, from, to, k) {
  if (band !== "2.4") return k >= from && k <= to ? 1 : 0;
  // 2.4 GHz: channels are 5 MHz apart and each signal is 20 MHz wide, so neighbours overlap.
  const lo = 2407 + 5 * from - 10;
  const hi = 2407 + 5 * to + 10;
  const kLo = 2407 + 5 * k - 10;
  const kHi = kLo + 20;
  return Math.max(0, Math.min(hi, kHi) - Math.max(lo, kLo)) / 20;
}

/**
 * One band's lanes, networks and recommendation.
 * @param {Band} band
 * @param {Heard[]} heard The networks heard around, without the one this computer is joined to.
 * @param {Heard | null} joined
 * @returns {BandModel}
 */
export function bandModel(band, heard, joined) {
  const mine = heard.filter((n) => n.band === band);
  const networks = mine.map((n) => {
    const [from, to] = spanOf(n);
    return { ...n, from, to };
  });
  const lanes = CHANNELS[band].map((channel) => {
    let load = 0;
    let count = 0;
    for (const n of networks) {
      const c = cover(band, n.from, n.to, channel);
      if (c > 0) count++;
      load += c * weightOf(n.rssi);
    }
    const rounded = Math.round(load * 100) / 100;
    return { channel, load: rounded, level: levelOf(rounded), count };
  });
  const loadAt = (/** @type {number} */ ch) => lanes.find((l) => l.channel === ch)?.load ?? 0;
  /** A candidate's load over every channel the joined network's width would cover there. */
  const width = joined?.band === band ? joined.width : 20;
  const blockLoad = (/** @type {number} */ ch) => {
    const [from, to] = spanOf({ ...(joined ?? mine[0]), band, channel: ch, width });
    return CHANNELS[band]
      .filter((c) => c >= from && c <= to)
      .reduce((sum, c) => sum + loadAt(c), 0);
  };
  const candidates = CANDIDATES[band].filter((ch) => CHANNELS[band].includes(ch));
  const best = candidates.reduce(
    (pick, ch) => (pick === null || blockLoad(ch) < blockLoad(pick) - 1e-9 ? ch : pick),
    /** @type {number | null} */ (null),
  );
  let current = null;
  if (joined && joined.band === band) {
    const [from, to] = spanOf(joined);
    current = { ...joined, from, to, current: true };
  }
  return {
    band,
    lanes,
    networks,
    recommended: networks.length > 0 || current ? best : null,
    current,
    verdict: verdictOf(band, current, best, blockLoad, loadAt),
  };
}

/**
 * What to say about a band: "Channel 6 is crowded; channel 11 is better" when the joined network's
 * channel is busy and a candidate carries clearly less; else how its channel is.
 * @param {Band} band @param {Placed | null} current @param {number | null} best
 * @param {(ch: number) => number} blockLoad @param {(ch: number) => number} loadAt
 */
function verdictOf(band, current, best, blockLoad, loadAt) {
  if (!current) {
    return best === null
      ? { key: "channels.verdict.quiet", params: { band } }
      : { key: "channels.verdict.pick", params: { band, best } };
  }
  const here = blockLoad(current.channel);
  const level = levelOf(loadAt(current.channel));
  if (
    best !== null &&
    best !== current.channel &&
    level !== "free" &&
    blockLoad(best) <= here - BUSY
  )
    return { key: "channels.verdict.move", params: { band, channel: current.channel, best } };
  return { key: `channels.verdict.${level}`, params: { band, channel: current.channel } };
}

/**
 * Every band that has something to draw, 2.4 GHz first; a band the joined network is on always shows.
 * @param {import("./wifi.js").WifiReport} report
 */
export function channelsModel(report) {
  /** @type {Band[]} */
  const bands = ["2.4", "5", "6"];
  return bands
    .filter((b) => report.nearby.some((n) => n.band === b) || report.current?.band === b)
    .map((b) => bandModel(b, report.nearby, report.current));
}
