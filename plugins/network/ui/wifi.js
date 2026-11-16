// `system_profiler SPAirPortDataType -json`, macOS's own Wi-Fi report, as values: whether Wi-Fi is
// on, the network this computer is joined to (channel, band, width, security mode, signal and noise)
// and the networks it hears around it. It only listens: nothing here joins or probes a network.
// Without Location Services for the desk, macOS writes every SSID as "<redacted>"; the channels are
// still there, so they are drawn and the reason is said (NET-14).

/**
 * @typedef {"2.4" | "5" | "6"} Band
 * @typedef {{ ssid: string | null, channel: number, band: Band, width: number, security: string,
 *   rssi: number | null, noise: number | null, phy: string }} Heard
 * @typedef {Heard & { rate: number | null }} Joined
 * @typedef {{ iface: string, on: boolean, current: Joined | null, nearby: Heard[], hidden: boolean }} WifiReport
 */

const REDACTED = "<redacted>";

/**
 * "149 (5GHz, 80MHz)" → { channel: 149, band: "5", width: 80 }; "1 (2GHz, 20MHz)" is 2.4 GHz.
 * @param {unknown} text
 * @returns {{ channel: number, band: Band, width: number } | null}
 */
export function parseChannel(text) {
  if (typeof text !== "string") return null;
  const m = /^(\d{1,3})\s*\((\d)GHz(?:,\s*(\d{2,3})MHz)?\)/.exec(text.trim());
  if (!m) return null;
  const band = m[2] === "2" ? "2.4" : m[2] === "5" ? "5" : m[2] === "6" ? "6" : null;
  if (!band) return null;
  return { channel: Number(m[1]), band, width: m[3] ? Number(m[3]) : 20 };
}

/** "spairport_security_mode_wpa2_personal" → "wpa2-personal"; "" when absent. @param {unknown} mode */
export function securityOf(mode) {
  if (typeof mode !== "string") return "";
  return mode.replace(/^spairport_security_mode_/, "").replace(/_/g, "-");
}

/** "-47 dBm / -92 dBm" → [-47, -92]. @param {unknown} text */
function signalOf(text) {
  if (typeof text !== "string") return [null, null];
  const m = /(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
}

/** @param {Record<string, unknown>} raw @returns {Heard | null} */
function heard(raw) {
  const channel = parseChannel(raw.spairport_network_channel);
  if (!channel) return null;
  const name = typeof raw._name === "string" ? raw._name : "";
  const [rssi, noise] = signalOf(raw.spairport_signal_noise);
  return {
    ssid: name && name !== REDACTED ? name : null,
    ...channel,
    security: securityOf(raw.spairport_security_mode),
    rssi,
    noise,
    phy: typeof raw.spairport_network_phymode === "string" ? raw.spairport_network_phymode : "",
  };
}

/**
 * The report of the first Wi-Fi interface; null when the text is not the report or the computer has
 * no Wi-Fi interface.
 * @param {string} text
 * @returns {WifiReport | null}
 */
export function parseWifi(text) {
  /** @type {any} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  const interfaces = doc?.SPAirPortDataType?.[0]?.spairport_airport_interfaces;
  if (!Array.isArray(interfaces)) return null;
  const wifi = interfaces.find(
    (i) => i && typeof i === "object" && "spairport_status_information" in i,
  );
  if (!wifi) return null;
  const on = wifi.spairport_status_information !== "spairport_status_off";
  const others = Array.isArray(wifi.spairport_airport_other_local_wireless_networks)
    ? wifi.spairport_airport_other_local_wireless_networks
    : [];
  const nearby = others.map(heard).filter((n) => n !== null);
  const info = wifi.spairport_current_network_information;
  const joined = info && typeof info === "object" ? heard(info) : null;
  const current = joined
    ? {
        ...joined,
        rate: typeof info.spairport_network_rate === "number" ? info.spairport_network_rate : null,
      }
    : null;
  const names = [...others, ...(info ? [info] : [])].map((n) => n?._name);
  return {
    iface: typeof wifi._name === "string" ? wifi._name : "",
    on,
    current: on ? current : null,
    nearby: on ? nearby : [],
    hidden: names.some((n) => n === REDACTED),
  };
}

/**
 * How safe a security mode is, for the checkup (NET-10): its points off and the word for it.
 * @param {string} security
 * @returns {{ level: "open" | "wep" | "wpa" | "mixed" | "wpa2" | "wpa3" | "enterprise" | "unknown", points: number }}
 */
export function securityLevel(security) {
  const s = security.toLowerCase();
  if (!s) return { level: "unknown", points: 0 };
  if (s === "none" || s === "open") return { level: "open", points: 25 };
  if (s.includes("wep")) return { level: "wep", points: 25 };
  if (s.includes("owe")) return { level: "wpa2", points: 5 };
  if (s.includes("wpa3"))
    return { level: s.includes("enterprise") ? "enterprise" : "wpa3", points: 0 };
  if (s.includes("enterprise")) return { level: "enterprise", points: 0 };
  if (s.includes("wpa2") && s.includes("mixed")) return { level: "mixed", points: 10 };
  if (s.includes("wpa2")) return { level: "wpa2", points: 5 };
  if (s.includes("wpa")) return { level: "wpa", points: 15 };
  return { level: "unknown", points: 0 };
}

/**
 * How strong a signal is (dBm): ≥ −60 good, ≥ −70 fair, below that weak.
 * @param {number | null} rssi
 * @returns {"good" | "fair" | "weak" | "unknown"}
 */
export function signalLevel(rssi) {
  if (rssi === null) return "unknown";
  if (rssi >= -60) return "good";
  if (rssi >= -70) return "fair";
  return "weak";
}
