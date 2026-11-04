// Emoji by the short names chat services write (`:tada:`), the quick reactions the plugin offers,
// and how one reaction reads aloud. A name the table does not hold stays as written.

/** The short names the services share most, as Unicode. */
export const SHORTCODES = /** @type {Record<string, string>} */ ({
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  heart: "❤️",
  joy: "😂",
  laughing: "😆",
  smile: "😄",
  smiley: "😃",
  grin: "😁",
  slightly_smiling_face: "🙂",
  wink: "😉",
  blush: "😊",
  heart_eyes: "😍",
  thinking_face: "🤔",
  thinking: "🤔",
  sob: "😭",
  cry: "😢",
  scream: "😱",
  sweat_smile: "😅",
  rofl: "🤣",
  upside_down_face: "🙃",
  neutral_face: "😐",
  confused: "😕",
  disappointed: "😞",
  angry: "😠",
  sunglasses: "😎",
  pray: "🙏",
  clap: "👏",
  wave: "👋",
  raised_hands: "🙌",
  muscle: "💪",
  ok_hand: "👌",
  point_up: "☝️",
  eyes: "👀",
  tada: "🎉",
  confetti_ball: "🎊",
  fire: "🔥",
  rocket: "🚀",
  sparkles: "✨",
  star: "⭐",
  boom: "💥",
  100: "💯",
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  x: "❌",
  warning: "⚠️",
  question: "❓",
  exclamation: "❗",
  bulb: "💡",
  memo: "📝",
  calendar: "📅",
  coffee: "☕",
  pizza: "🍕",
  beer: "🍺",
  bug: "🐛",
  lock: "🔒",
  key: "🔑",
  link: "🔗",
  pushpin: "📌",
  bell: "🔔",
  zap: "⚡",
  hourglass: "⌛",
  see_no_evil: "🙈",
  shrug: "🤷",
  facepalm: "🤦",
  ship: "🚢",
  wrench: "🔧",
  hammer: "🔨",
  gear: "⚙️",
  chart_with_upwards_trend: "📈",
  moneybag: "💰",
  gift: "🎁",
  trophy: "🏆",
  sunny: "☀️",
  rainbow: "🌈",
  plus: "➕",
});

/** The reactions offered with one click, unless `endue.chat.quick-reactions` says others. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅"];

const NAME = /^:([a-z0-9_+-]+):$/;

/** An emoji as drawn: Unicode for a known `:name:`, the text as written otherwise. */
export function emojiOf(/** @type {string} */ emoji) {
  const named = NAME.exec(emoji.trim());
  if (!named) return emoji.trim();
  return SHORTCODES[/** @type {string} */ (named[1])] ?? emoji.trim();
}

/** The same reaction however it was written: `:+1:`, `:thumbsup:` and 👍 are one. */
export const sameEmoji = (/** @type {string} */ a, /** @type {string} */ b) =>
  emojiOf(a) === emojiOf(b);

/** How a reaction reads aloud: "👍 3, including you". */
export function reactionLabel(/** @type {{ emoji: string, count: number, self: boolean }} */ r) {
  const who = r.self ? (r.count > 1 ? `, including you` : ", you") : "";
  return `${emojiOf(r.emoji)} ${r.count}${who}`;
}

/** The person's quick reactions from the setting: emoji or `:name:` strings, six at most. */
export function quickReactions(/** @type {unknown} */ value) {
  if (!Array.isArray(value)) return QUICK_REACTIONS;
  const picked = value
    .filter((v) => typeof v === "string" && v.trim() !== "")
    .map((v) => emojiOf(v))
    .slice(0, 6);
  return picked.length > 0 ? picked : QUICK_REACTIONS;
}
