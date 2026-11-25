// A preset is a set of form values. An empty field leaves that part of the device alone.
const networks = { full: "none", lte: "none", umts: "umts", edge: "edge", gprs: "gprs" };
export const builtins = [
  { name: "Low battery on EDGE", values: { battery: "8", charging: "off", network: "edge" } },
  { name: "Large text in dark mode", values: { appearance: "yes", font: "2.0" } },
  {
    name: "Charging on a fast connection",
    values: { battery: "100", charging: "on", network: "full" },
  },
];

function number(value, min, max, label, integer = false) {
  const text = String(value).trim();
  const n = Number(text);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ||
    n < min ||
    n > max ||
    (integer && !Number.isInteger(n))
  )
    throw new Error(`Enter ${label} between ${min} and ${max}.`);
  return String(n);
}

function choice(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`Choose a listed ${label}.`);
  return value;
}

export function environmentSteps(values) {
  const steps = [];
  const add = (label, ...args) => steps.push({ label, args });
  const {
    battery = "",
    charging = "",
    network = "",
    latitude = "",
    longitude = "",
    appearance = "",
    font = "",
  } = values;
  if (battery !== "")
    add(
      "battery level",
      "emu",
      "power",
      "capacity",
      number(battery, 0, 100, "a battery level", true),
    );
  if (charging)
    add("charger", "emu", "power", "ac", choice(charging, ["on", "off"], "charger state"));
  if (network) {
    choice(network, Object.keys(networks), "network");
    add("network speed", "emu", "network", "speed", network);
    add("network delay", "emu", "network", "delay", networks[network]);
  }
  if (latitude !== "" || longitude !== "") {
    const lat = number(latitude, -90, 90, "a latitude");
    const lon = number(longitude, -180, 180, "a longitude");
    add("GPS location", "emu", "geo", "fix", lon, lat);
  }
  if (appearance)
    add(
      "appearance",
      "shell",
      "cmd",
      "uimode",
      "night",
      choice(appearance, ["auto", "yes", "no"], "appearance"),
    );
  if (font)
    add(
      "font size",
      "shell",
      "settings",
      "put",
      "system",
      "font_scale",
      choice(font, ["1.0", "1.3", "1.5", "2.0"], "font size"),
    );
  if (!steps.length) throw new Error("Choose at least one device condition.");
  return steps;
}

export function savedPresets(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((p) => {
      if (typeof p?.name !== "string" || !p.name.trim() || p.name.length > 60) return false;
      try {
        return environmentSteps(p.values).length > 0;
      } catch {
        return false;
      }
    })
    .slice(0, 24);
}
