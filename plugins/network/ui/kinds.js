// What kind of device an address probably is, until the person says (NET-07): from its mDNS name,
// its manufacturer and the ports it answers on. A guess only fills the kind the person has not set.

/** Every kind a device can be, in the order the "Who is this?" form lists them. */
export const KINDS = Object.freeze([
  "router",
  "computer",
  "laptop",
  "phone",
  "tablet",
  "tv",
  "speaker",
  "camera",
  "printer",
  "console",
  "storage",
  "watch",
  "smartHome",
  "unknown",
]);

/** @typedef {(typeof KINDS)[number]} Kind */

/** Words in an mDNS name, first match wins. @type {Array<[RegExp, Kind]>} */
const NAME_RULES = [
  [/iphone|galaxy-?s\d|pixel|android|phone/i, "phone"],
  [/ipad|tab(let)?\b|galaxy-?tab/i, "tablet"],
  [/macbook|laptop|notebook|thinkpad|surface/i, "laptop"],
  [/imac|mac-?mini|mac-?studio|mac-?pro|desktop|\bpc\b|workstation/i, "computer"],
  [/watch/i, "watch"],
  [/apple-?tv|\btv\b|bravia|webos|tizen|roku|chromecast|fire-?tv/i, "tv"],
  [/homepod|sonos|echo|nest-?(mini|audio)|speaker|airport-?express/i, "speaker"],
  [/cam(era)?\b|ipc|nvr|dvr|doorbell/i, "camera"],
  [/print|laserjet|officejet|deskjet|epson|brother|canon/i, "printer"],
  [/playstation|\bps[45]\b|xbox|switch|nintendo/i, "console"],
  [/nas|synology|diskstation|qnap|drobo|time-?capsule/i, "storage"],
];

/** Manufacturers that make mostly one kind of device. @type {Array<[RegExp, Kind]>} */
const VENDOR_RULES = [
  [/hikvision|dahua|reolink|axis comm|amcrest|wyze|arlo|ezviz|hanwha|uniview/i, "camera"],
  [/hewlett|hp inc|epson|brother|canon|lexmark|xerox|kyocera|ricoh/i, "printer"],
  [/sonos|bose|harman/i, "speaker"],
  [/roku|vizio|tcl|hisense/i, "tv"],
  [/nintendo|sony interactive|microsoft.*xbox/i, "console"],
  [/synology|qnap|western digital|seagate|buffalo/i, "storage"],
  [
    /espressif|tuya|shelly|philips lighting|signify|ecobee|nest labs|xiaomi|aqara|\bring\b/i,
    "smartHome",
  ],
  [/tp-?link|netgear|asus|ubiquiti|mikrotik|d-link|zyxel|iptime|efm|linksys|eero/i, "router"],
  [/raspberry/i, "computer"],
];

/** Ports that give a device away. @type {Array<[number, Kind]>} */
const PORT_RULES = [
  [9100, "printer"],
  [631, "printer"],
  [515, "printer"],
  [554, "camera"],
  [62078, "phone"],
  [32400, "storage"],
  [5000, "storage"],
];

/**
 * The likely kind.
 * @param {{ name?: string | null, vendor?: string | null, ports?: number[], randomMac?: boolean,
 *   gateway?: boolean, self?: boolean }} hints
 * @returns {Kind}
 */
export function guessKind(hints) {
  if (hints.gateway) return "router";
  const name = hints.name ?? "";
  for (const [pattern, kind] of NAME_RULES) if (pattern.test(name)) return kind;
  const vendor = hints.vendor ?? "";
  for (const [pattern, kind] of VENDOR_RULES) if (pattern.test(vendor)) return kind;
  for (const [port, kind] of PORT_RULES) if (hints.ports?.includes(port)) return kind;
  if (hints.self) return "computer";
  // A made-up MAC address is what phones, tablets and laptops use on each Wi-Fi network.
  if (hints.randomMac) return "phone";
  return "unknown";
}

/** @param {unknown} value @returns {value is Kind} */
export function isKind(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (KINDS).includes(value);
}
