// Every value the studio hands docker is checked first (endue.docker's checks, so both plugins accept
// the same names): container, volume and network names, Compose project and context names, image
// references by the OCI distribution grammar, and the parts of a run (ports, environment, volumes,
// restart policy). Nothing that starts with a dash reaches docker as a value, and positional values
// come after `--`, so no argument is ever read as an option.

/** A thrown check: the message says what is wrong with which value. */
const bad = (/** @type {string} */ what, /** @type {unknown} */ value, /** @type {string} */ why) =>
  new Error(`${what} ${JSON.stringify(value)} ${why}`);

const OBJECT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * A container, volume or network: its name or id, as docker allows them.
 * @param {unknown} value
 * @param {string} [what]
 */
export function objectRef(value, what = "The container") {
  if (typeof value !== "string" || value === "") throw new Error(`${what} is not named.`);
  if (value.length > 255 || !OBJECT_NAME.test(value))
    throw bad(what, value, "is not a name docker allows (letters, digits, _ . -).");
  return value;
}

/** A Docker context name, as `docker context create` allows it. */
export function contextName(/** @type {unknown} */ value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(value))
    throw bad("The context", value, "is not a context name (letters, digits, _ . + -).");
  return value;
}

/** A Compose project name, as the Compose Specification allows it. */
export function projectName(/** @type {unknown} */ value) {
  if (typeof value !== "string" || value === "")
    throw new Error("The Compose project is not named.");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(value))
    throw bad("The Compose project", value, "is not a project name (a-z, 0-9, _ and -).");
  return value;
}

// The OCI distribution reference grammar (github.com/distribution/reference, regexp.go).
const PATH_COMPONENT = "[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*";
const DOMAIN_COMPONENT = "(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])";
const DOMAIN = `(?:${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*|\\[[a-fA-F0-9:]+\\])(?::[0-9]+)?`;
const NAME = `(?:${DOMAIN}/)?${PATH_COMPONENT}(?:/${PATH_COMPONENT})*`;
const TAG = "[\\w][\\w.-]{0,127}";
const DIGEST = "[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}";
const REFERENCE = new RegExp(`^(${NAME})(?::${TAG})?(?:@${DIGEST})?$`);
const IMAGE_ID = /^(sha256:)?[0-9a-f]{12,64}$/;

/**
 * An image reference (`nginx`, `ghcr.io/org/app:1.2`, `repo@sha256:…`) or an image id.
 * @param {unknown} value
 */
export function imageRef(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Say which image.");
  const ref = value.trim();
  if (IMAGE_ID.test(ref)) return ref;
  const match = REFERENCE.exec(ref);
  if (!match || (match[1] ?? "").length > 255)
    throw bad("The image", ref, "is not an image reference (name[:tag][@digest]).");
  return ref;
}

const PORT = /^\d{1,5}(?:-\d{1,5})?$/;
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** A port or a range, each 1 to 65535, the range in order. */
function portRange(/** @type {string} */ text, /** @type {string} */ spec) {
  if (!PORT.test(text)) throw bad("The port", spec, "is not [ip:][host:]container[/proto].");
  const [lo, hi = lo] = text.split("-").map(Number);
  if (!lo || !hi || lo > 65535 || hi > 65535 || lo > hi)
    throw bad("The port", spec, "is outside 1 to 65535.");
}

/** A published port: `80`, `8080:80`, `127.0.0.1:8080:80`, `[::1]::80`, `53:53/udp`. */
export function portSpec(/** @type {unknown} */ value) {
  if (typeof value !== "string" || value === "") throw new Error("A port is empty.");
  const [body = "", proto, extra] = value.split("/");
  if (extra !== undefined || (proto !== undefined && !/^(tcp|udp|sctp)$/.test(proto)))
    throw bad("The port", value, "has a protocol other than tcp, udp or sctp.");
  let ip = "";
  let rest = body;
  if (body.startsWith("[")) {
    const end = body.indexOf("]:");
    if (end < 0) throw bad("The port", value, "has an IPv6 address without a port after it.");
    ip = body.slice(0, end + 1);
    rest = body.slice(end + 2);
    if (!/^\[[0-9a-fA-F:]+\]$/.test(ip)) throw bad("The port", value, "has a bad IPv6 address.");
  }
  const parts = rest.split(":");
  if (!ip && parts.length === 3) {
    ip = parts.shift() ?? "";
    if (!IPV4.test(ip)) throw bad("The port", value, "has a bad IPv4 address.");
  }
  if (parts.length > 2 || (ip && parts.length !== 2))
    throw bad("The port", value, "is not [ip:][host:]container[/proto].");
  const [first = "", second] = parts;
  if (second === undefined) portRange(first, value);
  else {
    if (first !== "") portRange(first, value);
    portRange(second, value);
  }
  return value;
}

/** Environment as `KEY=value` lines; a bare `KEY` would pass the desk's own value, so it is refused. */
export function envSpecs(/** @type {unknown} */ value) {
  if (value === undefined) return [];
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? Object.entries(value).map(([key, v]) => `${key}=${String(v)}`)
      : undefined;
  if (!list) throw new Error("env is a list of KEY=value or an object.");
  return list.map((entry) => {
    if (typeof entry !== "string") throw bad("The variable", entry, "is not text.");
    const eq = entry.indexOf("=");
    const key = eq < 0 ? entry : entry.slice(0, eq);
    if (eq < 0) throw bad("The variable", entry, "has no value: write KEY=value.");
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key))
      throw bad("The variable", key, "is not a variable name.");
    if (entry.includes("\0")) throw bad("The variable", key, "holds a NUL character.");
    return entry;
  });
}

const VOLUME_OPTIONS = new Set(
  "ro rw z Z nocopy consistent cached delegated shared slave private rshared rslave rprivate".split(
    " ",
  ),
);

/** A mount: `/data` (anonymous), `name:/data`, `/host/path:/data:ro`. Targets are absolute. */
export function volumeSpec(/** @type {unknown} */ value) {
  if (typeof value !== "string" || value === "") throw new Error("A volume is empty.");
  const parts = value.split(":");
  const absolute = (/** @type {string | undefined} */ path) =>
    typeof path === "string" && path.startsWith("/") && !path.includes("\0");
  if (parts.length === 1) {
    if (!absolute(parts[0]))
      throw bad("The volume", value, "is not an absolute path in the container.");
    return value;
  }
  const [source = "", target, options] = parts;
  if (parts.length > 3) throw bad("The volume", value, "is not source:target[:options].");
  if (!absolute(source) && !OBJECT_NAME.test(source))
    throw bad(
      "The volume",
      value,
      "has a source that is neither an absolute path nor a volume name.",
    );
  if (!absolute(target))
    throw bad("The volume", value, "has a target that is not an absolute path.");
  for (const option of options?.split(",") ?? [])
    if (!VOLUME_OPTIONS.has(option))
      throw bad("The volume", value, `has an unknown option ${option}.`);
  return value;
}

/** `no`, `always`, `unless-stopped`, `on-failure` or `on-failure:N`. */
export function restartPolicy(/** @type {unknown} */ value) {
  if (
    typeof value !== "string" ||
    !/^(no|always|unless-stopped|on-failure(:\d{1,4})?)$/.test(value)
  )
    throw bad("The restart policy", value, "is not no, always, unless-stopped or on-failure[:N].");
  return value;
}
