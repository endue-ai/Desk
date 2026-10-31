// List numbers in the styles word processors use: decimal, letters, roman, and the Korean, CJK and
// circled forms Word, Hangul and LibreOffice write. Shared by every reader's list markers.

const ROMAN = /** @type {const} */ ([
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
]);

const roman = (/** @type {number} */ n) => {
  let out = "";
  let rest = n;
  for (const [value, digits] of ROMAN)
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  return out;
};

/** a, b, ... z, aa, bb (Word repeats the letter, as lowerLetter does). */
const letters = (/** @type {number} */ n) => {
  const index = (n - 1) % 26;
  return String.fromCharCode(97 + index).repeat(Math.floor((n - 1) / 26) + 1);
};

const GANADA = "가나다라마바사아자차카타파하";
const CHOSUNG = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ";
const CJK_DIGITS = "〇一二三四五六七八九";

const cjk = (/** @type {number} */ n) => {
  if (n < 10) return CJK_DIGITS[n] ?? String(n);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${tens > 1 ? CJK_DIGITS[tens] : ""}十${ones ? CJK_DIGITS[ones] : ""}`;
  }
  return String(n);
};

const cycle = (/** @type {string} */ set, /** @type {number} */ n) =>
  set[(n - 1) % set.length] ?? "";

/**
 * A list number in one of the named styles; unknown styles are decimal.
 * @param {number} n
 * @param {string} style Word's numFmt names, plus "a", "A", "i", "I", "1" as ODF and RTF write them
 */
export function formatNumber(n, style) {
  if (n < 1 && style !== "decimal" && style !== "1") return String(n);
  switch (style) {
    case "lowerLetter":
    case "a":
      return letters(n);
    case "upperLetter":
    case "A":
      return letters(n).toUpperCase();
    case "lowerRoman":
    case "i":
      return roman(n);
    case "upperRoman":
    case "I":
      return roman(n).toUpperCase();
    case "decimalZero":
      return String(n).padStart(2, "0");
    case "ganada":
    case "koreanLegal":
    case "가":
      return cycle(GANADA, n);
    case "chosung":
    case "ㄱ":
      return cycle(CHOSUNG, n);
    case "decimalEnclosedCircle":
    case "circledDecimal":
    case "①":
      return n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    case "decimalEnclosedParen":
      return `(${n})`;
    case "ideographDigital":
    case "japaneseCounting":
    case "chineseCounting":
    case "chineseCountingThousand":
    case "koreanDigital":
    case "一":
      return cjk(n);
    case "none":
      return "";
    default:
      return String(n);
  }
}

/** Symbol-font bullets Word stores in the private use area, as the characters they draw. */
const BULLETS = /** @type {Record<string, string>} */ ({
  "": "•",
  "": "▪",
  "": "◦",
  "": "➢",
  "": "✓",
  "": "❖",
  "": "◆",
  "": "➔",
  "": "■",
  "": "◇",
  "": "–",
  "": "★",
});

/**
 * A bullet as it should show: Symbol and Wingdings code points become real characters, Courier's
 * "o" a white bullet.
 * @param {string} text
 * @param {string} [font]
 */
export function bullet(text, font = "") {
  if (BULLETS[text]) return BULLETS[text] ?? text;
  const code = text.codePointAt(0) ?? 0;
  if (code >= 0xf000 && code <= 0xf0ff) return "•";
  if (text === "o" && /courier/i.test(font)) return "◦";
  if (/symbol|wingdings/i.test(font) && text === "§") return "▪";
  if (/symbol/i.test(font) && text === "·") return "•";
  return text;
}
