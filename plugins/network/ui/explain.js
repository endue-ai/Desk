// "Explain simply" (NET-16): the checkup's facts go to the desk's brain with brain.ask, and the
// answer comes back as a tool call's arguments (an explanation and steps), never read out of prose.
// What goes is only a device's kind, manufacturer and open ports and the score's items: never the
// names the person gave, never an SSID, never an address. Without a brain, or with it off, the
// plugin's own fixed sentences stand.
import { portInfo } from "./ports.js";

/**
 * @typedef {import("./devices.js").Device} Device
 * @typedef {import("./checkup.js").Checkup} Checkup
 * @typedef {{ summary: string, steps: string[] }} Explanation
 * @typedef {{ call(method: string, params: any): Promise<any>,
 *   onEvent(listener: (event: { event: string, data: any }) => void): () => void }} Bridge
 */

export const SCOPE = Object.freeze({ permission: "brain:ask" });
const WAIT_MS = 90_000;

export const EXPLAIN_TOOL = Object.freeze({
  name: "explain_network_finding",
  description: "Explain a home network checkup finding to someone who is not a network expert.",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        maxLength: 600,
        description: "What the finding means, in two or three plain sentences.",
      },
      steps: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 240 },
        description: "What to do, one step per item, in order.",
      },
    },
    required: ["summary", "steps"],
    additionalProperties: false,
  },
});

/** The desk's languages, as the prompt names them. @type {Record<string, string>} */
const LANGUAGES = { en: "English", ko: "Korean" };

/** The terms the answer must use as they are. */
export const TERMS = Object.freeze([
  "IP address",
  "MAC address",
  "manufacturer",
  "port",
  "Wi-Fi channel",
  "ping (ms)",
]);

/**
 * What one device's explanation sends: its kind, manufacturer and open ports, nothing else.
 * @param {Device} d
 */
export function devicePayload(d) {
  return {
    kind: d.kind,
    manufacturer: d.randomMac ? "random MAC address" : (d.vendor ?? "unknown"),
    openPorts: (d.open ?? []).map((port) => ({
      port,
      service: portInfo(port).service || "unknown",
    })),
    pingSpeed: d.speed,
  };
}

/**
 * What a checkup's explanation sends: the score, its items and each device behind a card by its
 * kind, manufacturer and open ports.
 * @param {Checkup} c @param {Device[]} devices
 */
export function checkupPayload(c, devices) {
  const behind = new Set(c.cards.map((card) => card.mac).filter(Boolean));
  return {
    score: c.score,
    items: c.items.map((i) => ({
      item: i.id,
      pointsOff: i.points,
      of: i.max,
      count: i.count,
      ...(i.level ? { level: i.level } : {}),
    })),
    devices: devices.filter((d) => behind.has(d.mac)).map(devicePayload),
  };
}

/** The prompt: the facts as JSON, the language and the rules for words. @param {unknown} payload @param {string} language */
export function promptFor(payload, language) {
  return [
    "You explain a home network checkup to a person who is not a network expert.",
    `Answer in ${LANGUAGES[language] ?? "English"}.`,
    `Use the standard terms as they are (${TERMS.join(", ")}; in Korean IP 주소, MAC 주소, 제조사, 포트, Wi-Fi 채널, 핑(ms)).`,
    "Do not compare the network to a house, rooms, doors, roads or lanes. Be concrete and calm.",
    "The steps must be things the person can do on their router or device; never ask them to run scanning tools.",
    `Facts:\n${JSON.stringify(payload, null, 2)}`,
  ].join("\n\n");
}

/** Check the tool's arguments. @param {unknown} value @returns {Explanation | null} */
export function explanationOf(value) {
  const v = /** @type {any} */ (value);
  if (!v || typeof v.summary !== "string" || !v.summary.trim()) return null;
  const steps = Array.isArray(v.steps)
    ? v.steps.filter((s) => typeof s === "string" && s.trim())
    : [];
  return { summary: v.summary.trim(), steps: steps.slice(0, 6).map((s) => s.trim()) };
}

/** @param {Bridge} bridge */
export function createExplainer(bridge) {
  /** @type {Map<string, (data: any) => void>} */
  const waiting = new Map();
  /** @type {Map<string, any>} */
  const early = new Map();
  /** The grant is asked for once per page. */
  let asked = false;
  bridge.onEvent((event) => {
    if (event.event !== "brain.turn") return;
    const data = event.data;
    if (!["completed", "error", "offline"].includes(data?.kind)) return;
    const settle = waiting.get(data.turnId);
    if (settle) settle(data);
    else early.set(data.turnId, data);
  });

  /**
   * Ask; resolves with the explanation, or null when there is no brain, it is off, refused or
   * answered in words only. The caller then shows its fixed sentences.
   * @param {unknown} payload @param {string} language @param {string} [reason] Why, if the grant is asked for.
   * @returns {Promise<Explanation | null>}
   */
  async function explain(payload, language, reason = "") {
    const params = {
      prompt: promptFor(payload, language),
      tool: EXPLAIN_TOOL,
      scope: { ...SCOPE },
    };
    /** @type {string} */
    let turnId;
    try {
      ({ turnId } = await bridge
        .call("brain.ask", params)
        .catch(async (/** @type {any} */ error) => {
          // Without the grant, ask the person once, then try again.
          if (error?.code !== "permission_denied" || asked) throw error;
          asked = true;
          const answer = await bridge.call("perm.request", { permission: { ...SCOPE }, reason });
          if (!answer?.granted) throw error;
          return bridge.call("brain.ask", params);
        }));
    } catch {
      // No brain on this desk (unsupported), not allowed, or off: the fixed sentences stand.
      return null;
    }
    const data = await new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), WAIT_MS);
      const finish = (/** @type {any} */ d) => {
        clearTimeout(timer);
        waiting.delete(turnId);
        resolve(d);
      };
      waiting.set(turnId, finish);
      const kept = early.get(turnId);
      if (kept) {
        early.delete(turnId);
        finish(kept);
      }
    });
    const d = /** @type {any} */ (data);
    return d?.kind === "completed" ? explanationOf(d.structured) : null;
  }
  return { explain };
}
