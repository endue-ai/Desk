// Published ports as links: a TCP port bound on this computer opens in the browser through
// `shell.open`, which only ever opens http and https (the manifest's shell:open grant).

/** @typedef {import("./parse-list.js").Port} Port */

/** The grant every open carries. */
export const LINKS = Object.freeze({ permission: "shell:open", schemes: ["http", "https"] });

/** Container ports that speak TLS by convention. */
const TLS = new Set(["443", "8443", "9443"]);

/**
 * The URL a published port opens at, or undefined when it is not a TCP port bound on the host.
 * An address of all interfaces is reached on localhost.
 * @param {Port} port
 */
export function portUrl(port) {
  if (port.host === "" || port.proto !== "tcp" || port.host.includes("-")) return undefined;
  const any = port.ip === "" || port.ip === "0.0.0.0" || port.ip === "::";
  const host = any ? "localhost" : port.ip.includes(":") ? `[${port.ip}]` : port.ip;
  return `${TLS.has(port.container) ? "https" : "http"}://${host}:${port.host}/`;
}

/** Whether a URL is one this plugin made for a port: http(s), a host, a port, nothing else. */
export function isPortUrl(/** @type {unknown} */ value) {
  return (
    typeof value === "string" &&
    /^https?:\/\/(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]):\d{1,5}\/$/.test(value)
  );
}
