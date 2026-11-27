// The manufacturer of a MAC address from its first three octets, the OUI, read from the IEEE
// registry the plugin carries as an asset (assets/oui.txt, made by dev/make-oui.mjs; NET-06). A MAC
// address whose locally administered bit is set was made up by the device, as phones and laptops do
// for each Wi-Fi network: it names no manufacturer, and says so.

/** @typedef {Map<string, string>} OuiTable */

/** "AABBCC<TAB>name" lines → prefix to name. @param {string} text @returns {OuiTable} */
export function parseOui(text) {
  /** @type {OuiTable} */
  const table = new Map();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab !== 6) continue;
    const name = line.slice(7).trim();
    if (name) table.set(line.slice(0, 6).toUpperCase(), name);
  }
  return table;
}

/** Whether the device made the address up (the locally administered bit). @param {string} mac */
export function isRandomMac(mac) {
  const first = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 2) !== 0;
}

/** @param {string} mac */
export function ouiOf(mac) {
  return mac.replace(/[:-]/g, "").slice(0, 6).toUpperCase();
}

/**
 * The manufacturer, or null: never for a random MAC address, whose first octets mean nothing.
 * @param {OuiTable} table @param {string} mac
 */
export function vendorOf(table, mac) {
  if (isRandomMac(mac)) return null;
  return table.get(ouiOf(mac)) ?? null;
}

/**
 * Read the table from the plugin's folder once; an empty table when the asset cannot be read, so
 * the plugin still works and says "unknown manufacturer".
 * @param {(url: string) => Promise<{ ok: boolean, text(): Promise<string> }>} fetcher
 * @param {string} [url]
 */
export async function loadOui(fetcher, url = "../assets/oui.txt") {
  try {
    const response = await fetcher(url);
    return response.ok ? parseOui(await response.text()) : new Map();
  } catch {
    return new Map();
  }
}
