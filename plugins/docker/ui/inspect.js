// `docker container inspect` (the Engine API's ContainerJSON) as the sections the detail view shows:
// overview, state and health, ports, mounts, networks, environment, labels and limits. Values that
// look like secrets are masked unless the person asked to see them. Reading never throws.

/**
 * @typedef {{ label: string, value: string, masked?: boolean }} Field
 * @typedef {{ id: string, title: string, fields: Field[] }} Section
 * @typedef {{ id: string, name: string, image: string, state: string, sections: Section[] }} Detail
 */

/** Environment keys whose values are hidden by default. */
const SECRET = /pass|secret|token|key|credential|auth|private|salt|cookie|session|dsn|cert/i;

const obj = (/** @type {unknown} */ value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value)
    : {};
const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
const str = (/** @type {unknown} */ value) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/** A zero time ("0001-01-01T00:00:00Z") means never. */
const when = (/** @type {unknown} */ value) => {
  const text = str(value);
  return text === "" || text.startsWith("0001-") ? "" : text;
};

/** Bytes as people read them: 512 MiB, 2 GiB. */
export function bytes(/** @type {number} */ n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

/** A command as one line, each part quoted when it has a space. */
const argv = (/** @type {unknown} */ value) =>
  list(value)
    .map((part) => (/\s/.test(str(part)) ? JSON.stringify(str(part)) : str(part)))
    .join(" ");

/** Keep only fields with a value. */
const fields = (/** @type {Array<[string, string]>} */ pairs) =>
  pairs.filter(([, value]) => value !== "").map(([label, value]) => ({ label, value }));

/**
 * @param {unknown} json One element of `docker container inspect`'s array.
 * @param {{ reveal?: boolean }} [options] `reveal` shows every environment value.
 * @returns {Detail}
 */
export function inspectModel(json, options = {}) {
  const c = obj(json);
  const config = obj(c.Config);
  const state = obj(c.State);
  const host = obj(c.HostConfig);
  const health = obj(state.Health);
  const restart = obj(host.RestartPolicy);
  const name = str(c.Name).replace(/^\//, "");

  /** @type {Section[]} */
  const sections = [];
  const add = (/** @type {string} */ id, /** @type {string} */ title, /** @type {Field[]} */ f) => {
    if (f.length > 0) sections.push({ id, title, fields: f });
  };

  const policy = str(restart.Name);
  const retries = Number(restart.MaximumRetryCount) || 0;
  add(
    "overview",
    "Overview",
    fields([
      ["Id", str(c.Id)],
      ["Image", str(config.Image)],
      ["Image id", str(c.Image)],
      ["Created", when(c.Created)],
      ["Command", argv(config.Cmd)],
      ["Entrypoint", argv(config.Entrypoint)],
      ["Working dir", str(config.WorkingDir)],
      ["User", str(config.User)],
      ["Restart policy", policy && policy !== "no" && retries ? `${policy}:${retries}` : policy],
      ["Restarts", c.RestartCount ? str(c.RestartCount) : ""],
      ["Platform", str(c.Platform)],
    ]),
  );

  const log = list(health.Log).slice(-5);
  add("state", "State", [
    ...fields([
      ["Status", str(state.Status)],
      ["Health", str(health.Status)],
      ["Started", when(state.StartedAt)],
      ["Finished", state.Running ? "" : when(state.FinishedAt)],
      ["Exit code", state.Running || !when(state.FinishedAt) ? "" : str(state.ExitCode)],
      ["Out of memory", state.OOMKilled ? "yes, it was killed" : ""],
      ["Error", str(state.Error)],
      ["Process id", state.Pid ? str(state.Pid) : ""],
    ]),
    ...log.map((entry) => ({
      label: `Check ${when(obj(entry).Start) || ""}`.trim(),
      value: `exit ${str(obj(entry).ExitCode)}: ${str(obj(entry).Output).trim().slice(0, 200)}`,
    })),
  ]);

  /** @type {Field[]} */
  const ports = [];
  for (const [inside, bindings] of Object.entries(obj(obj(c.NetworkSettings).Ports))) {
    const published = list(bindings).map((b) => {
      const ip = str(obj(b).HostIp);
      return `${ip && ip !== "0.0.0.0" && ip !== "::" ? `${ip}:` : ""}${str(obj(b).HostPort)}`;
    });
    ports.push({ label: inside, value: [...new Set(published)].join(", ") || "not published" });
  }
  add("ports", "Ports", ports);

  add(
    "mounts",
    "Mounts",
    list(c.Mounts).map((m) => {
      const mount = obj(m);
      const source = str(mount.Name) || str(mount.Source);
      return {
        label: str(mount.Destination),
        value: `${str(mount.Type)} ${source}${mount.RW === false ? " (read-only)" : ""}`.trim(),
      };
    }),
  );

  add(
    "networks",
    "Networks",
    Object.entries(obj(obj(c.NetworkSettings).Networks)).map(([net, value]) => {
      const n = obj(value);
      const ip = str(n.IPAddress);
      const parts = [
        ip ? `${ip}/${str(n.IPPrefixLen)}` : "",
        str(n.Gateway) && `via ${str(n.Gateway)}`,
      ];
      const aliases = list(n.Aliases).map(str).filter(Boolean);
      if (aliases.length) parts.push(`aliases ${aliases.join(", ")}`);
      return { label: net, value: parts.filter(Boolean).join(" · ") || "attached" };
    }),
  );

  add(
    "env",
    "Environment",
    list(config.Env).map((entry) => {
      const text = str(entry);
      const eq = text.indexOf("=");
      const key = eq < 0 ? text : text.slice(0, eq);
      const value = eq < 0 ? "" : text.slice(eq + 1);
      const masked = !options.reveal && SECRET.test(key) && value !== "";
      return { label: key, value: masked ? "••••••" : value, ...(masked ? { masked } : {}) };
    }),
  );

  add(
    "labels",
    "Labels",
    Object.entries(obj(config.Labels))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, value: str(value) })),
  );

  const cpus = Number(host.NanoCpus) / 1e9;
  add(
    "limits",
    "Limits",
    fields([
      ["Memory", bytes(Number(host.Memory))],
      ["Memory + swap", bytes(Number(host.MemorySwap))],
      ["CPUs", cpus > 0 ? String(cpus) : ""],
      ["CPU shares", host.CpuShares ? str(host.CpuShares) : ""],
      ["Processes", Number(host.PidsLimit) > 0 ? str(host.PidsLimit) : ""],
      ["Privileged", host.Privileged ? "yes" : ""],
      ["Read-only root", host.ReadonlyRootfs ? "yes" : ""],
      ["Network mode", str(host.NetworkMode)],
    ]),
  );

  return { id: str(c.Id), name, image: str(config.Image), state: str(state.Status), sections };
}

/** `docker container inspect` output as its first element, or undefined when it is not JSON. */
export function firstOf(/** @type {string} */ stdout) {
  try {
    const all = JSON.parse(stdout);
    return Array.isArray(all) ? all[0] : undefined;
  } catch {
    return undefined;
  }
}
