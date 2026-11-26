// The port check (NET-08): a few dozen ports people commonly leave open, each tried with net.connect
// and closed the moment it connects. Nothing is sent and nothing is read. Every address is checked
// against the network this computer is on first (ipv4.js), and each device's ports are asked for
// with perm.request before the first connection, the way Screen Sharing asks for a computer.
import { ipText, parseIp, targetRefusal } from "./ipv4.js";
import { NetworkRefusal } from "./refusal.js";

/**
 * @typedef {"high" | "admin" | "info"} Risk
 * @typedef {{ port: number, service: string, risk: Risk }} PortInfo
 * @typedef {{ open: number[], closed: number, silent: number, at: string }} PortResult
 * @typedef {{ call(method: string, params: any): Promise<any> }} Bridge
 */

/**
 * high: a service that sends passwords in the clear or lets anyone on the network in (Telnet,
 * FTP, SMB, RDP, VNC); admin: a device's web admin screen on a port other than 80 and 443.
 * @type {readonly PortInfo[]}
 */
export const PORTS = Object.freeze([
  { port: 21, service: "FTP", risk: "high" },
  { port: 22, service: "SSH", risk: "info" },
  { port: 23, service: "Telnet", risk: "high" },
  { port: 25, service: "SMTP", risk: "info" },
  { port: 53, service: "DNS", risk: "info" },
  { port: 80, service: "HTTP", risk: "info" },
  { port: 81, service: "HTTP", risk: "admin" },
  { port: 110, service: "POP3", risk: "info" },
  { port: 139, service: "SMB (NetBIOS)", risk: "high" },
  { port: 143, service: "IMAP", risk: "info" },
  { port: 443, service: "HTTPS", risk: "info" },
  { port: 445, service: "SMB", risk: "high" },
  { port: 515, service: "LPD", risk: "info" },
  { port: 548, service: "AFP", risk: "info" },
  { port: 554, service: "RTSP", risk: "info" },
  { port: 631, service: "IPP", risk: "info" },
  { port: 1883, service: "MQTT", risk: "info" },
  { port: 2323, service: "Telnet", risk: "high" },
  { port: 3000, service: "HTTP", risk: "info" },
  { port: 3306, service: "MySQL", risk: "info" },
  { port: 3389, service: "RDP", risk: "high" },
  { port: 5000, service: "HTTP", risk: "info" },
  { port: 5432, service: "PostgreSQL", risk: "info" },
  { port: 5900, service: "VNC", risk: "high" },
  { port: 5901, service: "VNC", risk: "high" },
  { port: 6379, service: "Redis", risk: "info" },
  { port: 7000, service: "AirPlay", risk: "info" },
  { port: 7547, service: "TR-069", risk: "admin" },
  { port: 8000, service: "HTTP", risk: "admin" },
  { port: 8008, service: "HTTP", risk: "info" },
  { port: 8080, service: "HTTP", risk: "admin" },
  { port: 8081, service: "HTTP", risk: "admin" },
  { port: 8443, service: "HTTPS", risk: "admin" },
  { port: 8888, service: "HTTP", risk: "admin" },
  { port: 9100, service: "Printer (JetDirect)", risk: "info" },
  { port: 10000, service: "Webmin", risk: "admin" },
  { port: 32400, service: "Plex", risk: "info" },
  { port: 62078, service: "iPhone sync", risk: "info" },
]);

/** @param {number} port @returns {PortInfo} */
export function portInfo(port) {
  return PORTS.find((p) => p.port === port) ?? { port, service: "", risk: "info" };
}

/** How long one connection may take before the port counts as silent. */
export const CONNECT_TIMEOUT_MS = 1200;
/** Sockets open at once: the core allows a caller eight. */
export const PARALLEL = 4;

/** The grant one device's check asks for: every port of the list on that one address. @param {string} ip */
export function scopeFor(ip) {
  return { permission: "net:connect", hosts: PORTS.map((p) => `${ip}:${p.port}`) };
}

const codeOf = (/** @type {unknown} */ e) => /** @type {{ code?: string }} */ (e)?.code ?? "error";

/**
 * Ask once for the existing fixed check on these local addresses.
 * @param {Bridge} bridge @param {string[]} ips
 * @param {import("./ipv4.js").Network | null} network @param {string} reason
 */
export async function allowPorts(bridge, ips, network, reason) {
  const valid = ips.map((ip) => {
    const refusal = targetRefusal(ip, network);
    if (refusal) throw new NetworkRefusal(refusal, { ip });
    return ipText(/** @type {number} */ (parseIp(ip)));
  });
  const hosts = [...new Set(valid.flatMap((ip) => scopeFor(ip).hosts))];
  const asked = await bridge
    .call("perm.request", {
      permission: { permission: "net:connect", hosts },
      duration: "always",
      reason,
    })
    .catch(() => ({ granted: false }));
  if (!asked.granted) throw new NetworkRefusal("ports-denied", { ip: valid.join(", ") });
}

/**
 * Check one device's ports.
 * @param {Bridge} bridge
 * @param {{ ip: string, network: import("./ipv4.js").Network | null, reason: string,
 *   now?: () => string, ports?: readonly PortInfo[], allowed?: boolean }} options
 * @returns {Promise<PortResult>}
 */
export async function checkPorts(bridge, options) {
  const refusal = targetRefusal(options.ip, options.network);
  if (refusal) throw new NetworkRefusal(refusal, { ip: options.ip });
  const ip = ipText(/** @type {number} */ (parseIp(options.ip)));
  const ports = options.ports ?? PORTS;
  if (!options.allowed) await allowPorts(bridge, [ip], options.network, options.reason);
  const scope = scopeFor(ip);
  /** @type {number[]} */
  const open = [];
  let closed = 0;
  let silent = 0;
  let next = 0;
  const worker = async () => {
    while (next < ports.length) {
      const { port } = ports[next++];
      try {
        const { socketId } = await bridge.call("net.connect", {
          host: ip,
          port,
          timeoutMs: CONNECT_TIMEOUT_MS,
          scope,
        });
        open.push(port);
        await bridge.call("net.close", { socketId }).catch(() => {});
      } catch (error) {
        const code = codeOf(error);
        if (code === "permission_denied") throw new NetworkRefusal("ports-denied", { ip });
        if (code === "unsupported") throw new NetworkRefusal("unsupported-net", {});
        if (code === "timeout") silent++;
        else closed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, ports.length) }, worker));
  return {
    open: open.sort((a, b) => a - b),
    closed,
    silent,
    at: (options.now ?? (() => new Date().toISOString()))(),
  };
}
