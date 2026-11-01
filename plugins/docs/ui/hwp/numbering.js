// Paragraph numbers and bullets: the fifteen number shapes Hangul writes (digits, circled, roman,
// letters, 가나다, ㄱㄴㄷ, 일이삼, 一二三 and their circled forms), and the counters that turn a
// numbering's format text ("^1.", "(^2)") into the marker of the next paragraph at a level.
import { bullet, formatNumber } from "../numbers.js";

const cycle = (/** @type {string} */ set, /** @type {number} */ n) =>
  [...set][(n - 1) % [...set].length] ?? String(n);

/** A run of consecutive code points from `first`, `count` long, or the plain number past it. */
const circled = (
  /** @type {number} */ first,
  /** @type {number} */ count,
  /** @type {number} */ n,
) => (n >= 1 && n <= count ? String.fromCodePoint(first + n - 1) : String(n));

const KOREAN = "영일이삼사오육칠팔구";

/** 일, 이, ... 십, 십일, 이십, 백: Korean numerals for list numbers. */
function korean(/** @type {number} */ n) {
  if (n < 10) return KOREAN[n] ?? String(n);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    return `${tens > 1 ? KOREAN[tens] : ""}십${n % 10 ? KOREAN[n % 10] : ""}`;
  }
  return String(n);
}

/**
 * A number in one of Hangul's number shapes (HWP 5.0, the numbering and footnote tables).
 * @param {number} n
 * @param {number} shape
 */
export function hwpNumber(n, shape) {
  switch (shape) {
    case 1:
      return formatNumber(n, "decimalEnclosedCircle");
    case 2:
      return formatNumber(n, "upperRoman");
    case 3:
      return formatNumber(n, "lowerRoman");
    case 4:
      return formatNumber(n, "upperLetter");
    case 5:
      return formatNumber(n, "lowerLetter");
    case 6:
      return circled(0x24b6, 26, n);
    case 7:
      return circled(0x24d0, 26, n);
    case 8:
      return formatNumber(n, "ganada");
    case 9:
      return circled(0x326e, 14, n);
    case 10:
      return formatNumber(n, "chosung");
    case 11:
      return circled(0x3260, 14, n);
    case 12:
      return korean(n);
    case 13:
      return formatNumber(n, "ideographDigital");
    case 14:
      return circled(0x3280, 10, n);
    case 15:
      return cycle("갑을병정무기경신임계", n);
    case 16:
      return cycle("甲乙丙丁戊己庚辛壬癸", n);
    default:
      return String(n);
  }
}

/**
 * The counters of a document: each numbering counts per level, and a number at one level resets
 * the levels below it, as Hangul's outline and numbered paragraphs do.
 * @param {import("./docinfo.js").Level[][]} numberings
 */
export function counters(numberings) {
  /** @type {Map<number, number[]>} */
  const counts = new Map();
  /**
   * The marker of the next paragraph numbered by `id` (1-based) at `level` (0-based).
   * @param {number} id
   * @param {number} level
   * @returns {string | undefined}
   */
  return (id, level) => {
    const levels = numberings[id - 1];
    const head = levels?.[level];
    if (!levels || !head) return undefined;
    const count = counts.get(id) ?? [];
    counts.set(id, count);
    for (let i = 0; i < level; i++) count[i] ??= levels[i]?.start ?? 1;
    count[level] = (count[level] ?? head.start - 1) + 1;
    count.length = level + 1;
    const at = (/** @type {number} */ i) => hwpNumber(count[i] ?? 1, levels[i]?.shape ?? 0);
    const path = count.map((_, i) => at(i)).join(".");
    const text = head.text.replace(/\^([0-9nN])/g, (_, d) => {
      if (d === "n") return path;
      if (d === "N") return `${path}.`;
      const i = d === "0" ? 9 : Number(d) - 1;
      return i <= level ? at(i) : "";
    });
    return text || undefined;
  };
}

/** A bullet as it should show: Wingdings code points in the private use area become characters. */
export const bulletMarker = (/** @type {string | undefined} */ char) =>
  char && char !== "\u0000" ? bullet(char, "Wingdings") : "•";
