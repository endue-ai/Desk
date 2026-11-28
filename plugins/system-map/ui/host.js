import { idFor, msg, node, profile } from "./model.js";

export function hardware(text) {
  return profile(text, "SPHardwareDataType").map((r, index) =>
    node(idFor("hardware", index), r.machine_name || msg("group.hardware"), {
      model: r.machine_model,
      chip: r.chip_type ?? r.cpu_type,
      memory: r.physical_memory,
      cores: r.number_processors,
      firmware: r.boot_rom_version,
    }),
  );
}

export function power(text) {
  const source = /drawing from '([^']+)'/.exec(text)?.[1];
  if (!source) throw Error();
  const values = [node("power.source", msg("field.powerSource"), { powerSource: source })];
  for (const line of text.split("\n")) {
    const match = /^\s*-([^\s]+).*?(\d+%);\s*([^;]+);?\s*([^;]*)/.exec(line);
    if (match)
      values.push(
        node(idFor("battery", match[1]), match[1], {
          charge: match[2],
          status: match[3],
          remaining: match[4].replace(/\s*present:.*$/, "").trim(),
        }),
      );
  }
  return values;
}

export function batterySensors(text) {
  const fields = {};
  for (const [property, key, unit] of [
    ["Voltage", "voltage", "mV"],
    ["CycleCount", "cycles", ""],
    ["AppleRawCurrentCapacity", "capacity", "mAh"],
  ]) {
    const found = new RegExp(`^\\s*[^"]*"${property}" = (\\d+)\\s*$`, "m").exec(text);
    if (found) fields[key] = [found[1], unit].filter(Boolean).join(" ");
  }
  return Object.keys(fields).length
    ? [node("sensors.battery", msg("group.batterySensors"), fields)]
    : [];
}

export function thermal(text) {
  const readings = [];
  for (const [key, title, unit] of [
    ["CPU_Speed_Limit", "cpuLimit", "%"],
    ["CPU_Scheduler_Limit", "schedulerLimit", "%"],
    ["CPU_Available_CPUs", "availableCpus", ""],
  ]) {
    const value = new RegExp(`\\b${key}\\s*=\\s*(\\d+)`).exec(text)?.[1];
    if (value) readings.push(node(key, msg(`field.${title}`), { reading: value + unit }));
  }
  for (const line of text
    .split("\n")
    .filter(
      (line) =>
        /thermal warning level|performance warning level/i.test(line) && !/error/i.test(line),
    )) {
    readings.push(node(idFor("thermal", line), msg("field.warning"), { reading: line.trim() }));
  }
  if (!readings.length) throw Error();
  return readings;
}

export function processes(text) {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+([\d.,]+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!m) return [];
    const [, pid, cpu, rss, path] = m;
    const bundle = /^(.*?\/([^/]+)\.app)\//i.exec(path);
    return [
      {
        pid,
        cpu: `${cpu}%`,
        rss: `${rss} KiB`,
        path,
        app: bundle?.[2],
        bundle: bundle?.[1],
        name: path.split("/").at(-1),
      },
    ];
  });
}
