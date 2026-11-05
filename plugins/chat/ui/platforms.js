// The chat services the plugin knows by name: what a person reads for each (its name and a short
// mark), and which of the theme's eight chart colours it wears. A service is never drawn with its
// logo: a name and a theme colour, so a theme decides every colour and no trademark asset is kept.
// Pure functions, so the tests run them in Node.

/**
 * @typedef {{ id: string, name: string, mark: string, hue: number }} Platform
 * `hue` is 1 to 8: the theme's `--desk-chart-<hue>`.
 */

/** The services the plugin names; any other id is shown by its own name. */
export const PLATFORMS = /** @type {Platform[]} */ ([
  { id: "slack", name: "Slack", mark: "Sl", hue: 5 },
  { id: "discord", name: "Discord", mark: "Di", hue: 4 },
  { id: "teams", name: "Microsoft Teams", mark: "Te", hue: 1 },
  { id: "telegram", name: "Telegram", mark: "Tg", hue: 2 },
  { id: "matrix", name: "Matrix", mark: "Mx", hue: 8 },
  { id: "irc", name: "IRC", mark: "IR", hue: 3 },
  { id: "whatsapp", name: "WhatsApp", mark: "Wa", hue: 6 },
  { id: "signal", name: "Signal", mark: "Si", hue: 4 },
  { id: "mattermost", name: "Mattermost", mark: "Mm", hue: 1 },
  { id: "rocketchat", name: "Rocket.Chat", mark: "Rc", hue: 5 },
  { id: "zulip", name: "Zulip", mark: "Zu", hue: 2 },
  { id: "googlechat", name: "Google Chat", mark: "Gc", hue: 6 },
  { id: "line", name: "LINE", mark: "Li", hue: 6 },
  { id: "kakaotalk", name: "KakaoTalk", mark: "Ka", hue: 3 },
]);

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));
/** Other spellings a connector id or raw.platform may use. */
const ALIASES = /** @type {Record<string, string>} */ ({
  msteams: "teams",
  "microsoft-teams": "teams",
  rocket: "rocketchat",
  "rocket-chat": "rocketchat",
  gchat: "googlechat",
  "google-chat": "googlechat",
  kakao: "kakaotalk",
  wa: "whatsapp",
  tg: "telegram",
});

/** The fallback for a connector that names no service. */
export const CHAT = /** @type {Platform} */ ({ id: "chat", name: "Chat", mark: "Ch", hue: 8 });

/** A stable 1 to 8 for any text, so a name keeps its colour across restarts and desks. */
export function hueOf(/** @type {string} */ text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 8) + 1;
}

const normal = (/** @type {string} */ id) => {
  const lower = id
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/g, "-");
  return ALIASES[lower] ?? lower.replace(/-/g, "");
};

/** The service of an id the person or a connector wrote: known, or shown by its own name. */
export function platformOf(/** @type {string} */ id) {
  const key = normal(id);
  const known = BY_ID.get(key);
  if (known) return known;
  if (key === "" || key === CHAT.id) return CHAT;
  const name = id.trim();
  return {
    id: key,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    mark: (name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?").replace(/^./, (c) =>
      c.toUpperCase(),
    ),
    hue: hueOf(key),
  };
}

/**
 * Which service a message comes from: `raw.platform` when the connector says, else a known
 * service among the connector id's parts (`acme.slack`, `example.discord-export`), else Chat.
 * @param {unknown} raw the message's `raw.platform`
 * @param {string} connector the connector plugin's id
 */
export function detectPlatform(raw, connector) {
  if (typeof raw === "string" && raw.trim() !== "") return platformOf(raw);
  const parts = connector.toLowerCase().split(/[.\-_]/);
  for (const part of parts) {
    const id = ALIASES[part] ?? part;
    const known = BY_ID.get(id);
    if (known) return known;
  }
  return CHAT;
}
