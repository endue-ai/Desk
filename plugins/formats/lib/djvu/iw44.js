// IW44, DjVu's wavelet codec for colour and grey layers (DjVu v3 specification, appendix 1): the
// chunk headers, the slices, and the four passes that refine each block's wavelet coefficients.
// iw44-image.js turns the coefficients back into pixels.

import { reconstruct, STEP_INDEX } from "./iw44-image.js";
import { ZPDecoder } from "./zp.js";

const LARGEST = 64 * 1024 * 1024; // pixels
const OVERRUN = 64; // bytes read past a chunk's end before it counts as damaged

// Table 2: the coefficients of each band.
const BAND_LO = [0, 16, 32, 48, 64, 128, 192, 256, 512, 768];
const BAND_HI = [16, 32, 48, 64, 128, 192, 256, 512, 768, 1024];
// Table 4: the initial step sizes. Table 5: the step-size entries each band halves.
const INITIAL_STEPS = [
  0x4000, 0x8000, 0x8000, 0x10000, 0x10000, 0x10000, 0x20000, 0x20000, 0x20000, 0x40000, 0x40000,
  0x40000, 0x80000, 0x40000, 0x40000, 0x80000,
];
const REDUCED = [[0, 1, 2, 3, 4, 5, 6], [7], [8], [9], [10], [11], [12], [13], [14], [15]];

// Contexts of one colour component: decode buckets, decode coefficients (8 per band),
// activate coefficient (8 per value of the ACTIVE flag), increase coefficient.
const BUCKETS = 0;
const COEFFICIENTS = 1;
const ACTIVATE = 81;
const INCREASE = 97;
const CONTEXTS = 98;

const ACTIVE = 1;
const POTENTIAL = 2;

/** One IW44 layer (a BG44, FG44, PM44, BM44 or TH44 series): its coefficients so far. */
export class IW44Image {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.color = false;
    this.slices = 0;
    /** The serial number the next chunk must carry. */
    this.serial = 0;
    /** @type {Int16Array[]} one array per colour component, 1024 coefficients per block */
    this.coefficients = [];
    /** @type {Int32Array[]} */
    this.steps = [];
    /** @type {Uint8Array[]} */
    this.contexts = [];
    this.lumaBand = 0;
    this.chromaBand = 0;
    this.delay = 0;
    this.blocksWide = 0;
    this.blocksHigh = 0;
    this.flags = new Uint8Array(1024);
    this.bucketFlags = new Uint8Array(64);
    this.decodeBucket = new Uint8Array(64);
  }

  /**
   * Decodes one more chunk of this layer: its header, then its slices.
   * @param {Uint8Array} bytes @param {import("./pace.js").Pacer} [pace]
   */
  async decodeChunk(bytes, pace) {
    pace?.check();
    if (bytes.length < 2) throw new Error("An IW44 chunk is too short to have a header.");
    const serial = bytes[0];
    const slices = bytes[1];
    if (serial !== this.serial) {
      throw new Error(
        this.serial === 0
          ? "The first IW44 chunk of this image is missing."
          : `IW44 chunk ${serial + 1} arrived where chunk ${this.serial + 1} was expected.`,
      );
    }
    let at = 2;
    if (serial === 0) {
      if (bytes.length < 9) throw new Error("The first IW44 chunk is too short for its header.");
      this.start(bytes);
      at = 9;
    }
    this.serial++;
    const zp = new ZPDecoder(bytes, at);
    for (let s = 0; s < slices; s++) {
      await this.slice(zp, pace);
      this.slices++;
    }
    if (zp.past > OVERRUN) throw new Error("An IW44 chunk ends before its slices do.");
  }

  /** Reads the first chunk's header and sets the layer up. @param {Uint8Array} bytes */
  start(bytes) {
    const major = bytes[2] & 0x7f;
    if (major !== 1)
      throw new Error(`This IW44 image uses version ${major}, which is not supported.`);
    this.color = (bytes[2] & 0x80) === 0;
    this.width = (bytes[4] << 8) | bytes[5];
    this.height = (bytes[6] << 8) | bytes[7];
    this.delay = bytes[8] & 0x7f;
    if (this.width === 0 || this.height === 0) throw new Error("An IW44 image has no pixels.");
    if (this.width * this.height > LARGEST)
      throw new Error("An IW44 image is too large to decode.");
    this.blocksWide = Math.ceil(this.width / 32);
    this.blocksHigh = Math.ceil(this.height / 32);
    const count = this.color ? 3 : 1;
    const blocks = this.blocksWide * this.blocksHigh;
    for (let c = 0; c < count; c++) {
      this.coefficients.push(new Int16Array(blocks * 1024));
      this.steps.push(Int32Array.from(INITIAL_STEPS));
      this.contexts.push(new Uint8Array(CONTEXTS));
    }
  }

  /** One slice: a band of every component present. @param {ZPDecoder} zp @param {import("./pace.js").Pacer} [pace] */
  async slice(zp, pace) {
    const chroma = this.color && this.delay === 0;
    await this.band(zp, 0, this.lumaBand, pace);
    if (chroma) {
      await this.band(zp, 1, this.chromaBand, pace);
      await this.band(zp, 2, this.chromaBand, pace);
    }
    halve(this.steps[0], this.lumaBand);
    this.lumaBand = (this.lumaBand + 1) % 10;
    if (chroma) {
      halve(this.steps[1], this.chromaBand);
      halve(this.steps[2], this.chromaBand);
      this.chromaBand = (this.chromaBand + 1) % 10;
    } else if (this.delay > 0) this.delay--;
  }

  /**
   * One colour band: the block band of every block, bottom row first.
   * @param {ZPDecoder} zp @param {number} component @param {number} band
   * @param {import("./pace.js").Pacer} [pace]
   */
  async band(zp, component, band, pace) {
    const steps = this.steps[component];
    // Nothing in the band can change while all its step sizes are 0 or at least 0x8000.
    let live = false;
    for (const index of REDUCED[band]) if (steps[index] > 0 && steps[index] < 0x8000) live = true;
    if (!live) return;
    for (let row = 0; row < this.blocksHigh; row++) {
      for (let column = 0; column < this.blocksWide; column++) {
        this.blockBand(zp, component, band, (row * this.blocksWide + column) * 1024);
      }
      if (zp.past > OVERRUN) throw new Error("An IW44 chunk ends before its slices do.");
      if (pace?.due()) await pace.rest();
    }
  }

  /**
   * The preliminary flags and the four passes for one block band.
   * @param {ZPDecoder} zp @param {number} component @param {number} band @param {number} base
   */
  blockBand(zp, component, band, base) {
    const coef = this.coefficients[component];
    const steps = this.steps[component];
    const ctx = this.contexts[component];
    const flags = this.flags;
    const bucketFlags = this.bucketFlags;
    const lo = BAND_LO[band];
    const hi = BAND_HI[band];
    const first = lo >> 4;
    const buckets = (hi - lo) >> 4;
    let blockFlags = 0;
    for (let b = 0; b < buckets; b++) {
      let f = 0;
      const start = lo + (b << 4);
      for (let i = start; i < start + 16; i++) {
        const step = steps[STEP_INDEX[i]];
        let g = 0;
        if (step > 0 && step < 0x8000) g = coef[base + i] === 0 ? POTENTIAL : ACTIVE;
        flags[i] = g;
        f |= g;
      }
      bucketFlags[b] = f;
      blockFlags |= f;
    }
    if (blockFlags === 0) return;
    const blockActive = blockFlags & ACTIVE ? 1 : 0;

    // Passes 1 and 2: which buckets have coefficients to activate.
    let decodeBuckets = (blockFlags & POTENTIAL) !== 0;
    if (decodeBuckets && buckets === 16 && !blockActive)
      decodeBuckets = zp.decode(ctx, BUCKETS) === 1;
    const decodeBucket = this.decodeBucket;
    if (decodeBuckets) {
      for (let b = 0; b < buckets; b++) {
        decodeBucket[b] = 0;
        if (!(bucketFlags[b] & POTENTIAL)) continue;
        // The printed text counts the coefficients t..t+3 that are 0; c44's streams need the
        // count of those that are not.
        let n0 = 0;
        if (band > 0) {
          const t = base + ((first + b) << 2);
          for (let i = t; i < t + 4; i++) if (coef[i] !== 0) n0++;
          if (n0 === 4) n0 = 3;
        }
        decodeBucket[b] = zp.decode(ctx, COEFFICIENTS + band * 8 + blockActive * 4 + n0);
      }
      // Pass 3: newly active coefficients and their signs.
      for (let b = 0; b < buckets; b++) {
        if (!decodeBucket[b]) continue;
        const start = lo + (b << 4);
        let np = 0;
        for (let i = start; i < start + 16; i++) if (flags[i] === POTENTIAL) np++;
        // "The block's ACTIVE flag" is the bucket's: c44's streams decode only that way.
        const offset = ACTIVATE + (bucketFlags[b] & ACTIVE ? 8 : 0);
        for (let i = start; i < start + 16; i++) {
          if (flags[i] !== POTENTIAL) continue;
          if (zp.decode(ctx, offset + Math.min(np, 7))) {
            const step = steps[STEP_INDEX[i]];
            const value = (3 * step) >> 1;
            coef[base + i] = zp.iwPassthrough() ? -value : value;
            np = 0;
          }
          if (np > 0) np--;
        }
      }
    }

    // Pass 4: one more bit of every coefficient that was already active.
    if (!blockActive) return;
    for (let i = lo; i < hi; i++) {
      if (flags[i] !== ACTIVE) continue;
      const step = steps[STEP_INDEX[i]];
      const value = coef[base + i];
      let size = value < 0 ? -value : value;
      const up = size <= 3 * step ? zp.decode(ctx, INCREASE) : zp.iwPassthrough();
      if (step === 1) {
        if (!up) size -= 1;
      } else size += up ? step >> 1 : -(step >> 1);
      if (size > 32767) size = 32767;
      coef[base + i] = value < 0 ? -size : size;
    }
  }

  /**
   * The image so far, reduced by `subsample` (1, 2, 4, 8 or 16), as RGBA rows top first.
   * @param {{ subsample?: number, pace?: import("./pace.js").Pacer }} [options]
   * @returns {Promise<{ width: number, height: number, rgba: Uint8Array }>}
   */
  async render({ subsample = 1, pace } = {}) {
    if (this.serial === 0) throw new Error("An IW44 image has no data to render.");
    if (![1, 2, 4, 8, 16].includes(subsample)) {
      throw new Error("An IW44 image can only be reduced by 1, 2, 4, 8 or 16.");
    }
    return reconstruct(this, subsample, pace);
  }
}

/** Halves the step sizes of one band; a step of 1 becomes 0. @param {Int32Array} steps @param {number} band */
function halve(steps, band) {
  for (const index of REDUCED[band]) steps[index] >>= 1;
}
