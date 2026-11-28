import { batterySensors, hardware, power, processes, thermal } from "./host.js";
import { group, idFor, msg, node, source } from "./model.js";
import { interfaces, peers, socketNode, sockets, vpn } from "./network.js";
import { physicalSensors, usb } from "./peripherals.js";
import { bluetooth, wifi } from "./radios.js";

function appsTree(reports, entries) {
  const byPid = new Map();
  for (const entry of entries) {
    if (!byPid.has(entry.pid)) byPid.set(entry.pid, []);
    byPid.get(entry.pid).push(socketNode(entry, "appSocket"));
  }
  return source("apps", reports.processes, (text) => {
    const bundles = new Map();
    const other = [];
    for (const process of processes(text)) {
      const { pid, cpu, rss, path, app, bundle, name } = process;
      const processNode = node(
        idFor("proc", pid, path),
        name,
        { pid, cpu, rss, path },
        byPid.get(pid) ?? [],
      );
      if (!bundle) {
        other.push(processNode);
        continue;
      }
      if (!bundles.has(bundle))
        bundles.set(bundle, node(idFor("app", bundle), app, { path: bundle }, []));
      bundles.get(bundle).children.push(processNode);
    }
    const children = [...bundles.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (other.length) children.push(group("otherProcesses", other));
    return children;
  });
}

/** One in-memory snapshot. Missing reports and successful empty reports have different states. */
export function snapshot(reports) {
  const host = source("hardware", reports.hardware, hardware);
  const sensorNodes = [
    source("physicalSensors", reports.physicalSensors, physicalSensors),
    source("power", reports.battery, power),
    source("thermal", reports.thermal, thermal),
    source("batterySensors", reports.batterySensors, batterySensors),
  ];
  const entries = sockets(reports.sockets ?? "");
  const socketGroup = (id, predicate) =>
    source(id, reports.sockets, () => entries.filter(predicate).map((s) => socketNode(s, id)));
  const network = group("network", [
    source("interfaces", reports.interfaces, interfaces),
    source("vpn", reports.vpn, vpn),
    source("wifi", reports.wifi, wifi),
    source("peers", reports.peers, peers),
    source("neighbors6", reports.neighbors6, peers),
    socketGroup("listeners", (s) => s.state === "LISTEN"),
    socketGroup("connections", (s) => Boolean(s.remote)),
    socketGroup("bound", (s) => !s.remote && s.protocol === "UDP"),
  ]);
  network.children.find((n) => n.id === "listeners").fields.note = msg("network.reachability");
  const apps = appsTree(reports, entries);
  if (typeof reports.sockets !== "string") apps.fields.connections = msg("status.unavailable");
  return node(
    "computer",
    host.children[0]?.label ?? msg("group.computer"),
    host.children[0]?.fields ?? {},
    [
      host,
      source("usb", reports.usb, usb),
      group("sensors", sensorNodes),
      network,
      source("bluetooth", reports.bluetooth, bluetooth),
      apps,
    ],
  );
}
