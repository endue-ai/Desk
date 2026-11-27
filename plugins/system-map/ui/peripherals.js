import { idFor, node } from "./model.js";

// IOHWSensor is published on some Macs. Drivers choose the scale of current-value.
export function physicalSensors(text) {
  const readings = [];
  let sensor;
  for (const line of text.split("\n")) {
    const header = /\+-o (.+?)\s+<class ([^,]+), id ([^,>]+)/.exec(line);
    if (header) {
      sensor = node(idFor("sensor", header[3]), header[1], { driver: header[2] });
      readings.push(sensor);
      continue;
    }
    const prop = /"(location|type|current-value)"\s*=\s*(?:"([^"]*)"|(-?\d+))/.exec(line);
    if (sensor && prop) {
      const key = { location: "location", type: "kind", "current-value": "nativeValue" }[prop[1]];
      sensor.fields[key] = prop[2] ?? prop[3];
    }
  }
  return readings;
}

// IORegistry indentation describes the physical USB host / hub / device hierarchy.
export function usb(text) {
  const roots = [];
  const stack = [];
  for (const line of text.split("\n")) {
    const m = /^(.*?)\+-o (.+?)\s+<class ([^,]+), id ([^,>]+)/.exec(line);
    if (!m || m[3] === "IORegistryEntry") continue;
    const [name, location] = m[2].split("@");
    const device = node(idFor("usb", m[4]), name, { location, driver: m[3] });
    const indent = m[1].length;
    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    (stack.at(-1)?.device.children ?? roots).push(device);
    stack.push({ indent, device });
  }
  return roots;
}
