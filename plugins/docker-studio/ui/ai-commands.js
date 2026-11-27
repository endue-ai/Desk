// Running a docker command AI suggested: only docker's own subcommands on a short list, no
// argument that could reach the host (privileged, the host's namespaces, the Docker socket),
// always shown in full and asked first, its output said where the suggestion stood.

/** Subcommands AI may suggest, and those that change something (asked with a warning). */
const READS = new Set([
  "ps",
  "logs",
  "inspect",
  "top",
  "stats",
  "images",
  "version",
  "info",
  "port",
  "diff",
  "history",
  "search",
]);
const CHANGES = new Set([
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
  "kill",
  "rm",
  "rmi",
  "pull",
  "tag",
  "rename",
  "update",
  "run",
  "create",
  "exec",
  "cp",
  "build",
]);
const GROUPS = /** @type {Record<string, Set<string>>} */ ({
  container: new Set([
    "ls",
    "inspect",
    "logs",
    "start",
    "stop",
    "restart",
    "rm",
    "prune",
    "top",
    "stats",
    "update",
    "rename",
    "kill",
    "pause",
    "unpause",
    "port",
  ]),
  image: new Set(["ls", "inspect", "history", "pull", "rm", "prune", "tag", "push"]),
  volume: new Set(["ls", "inspect", "create", "rm", "prune"]),
  network: new Set(["ls", "inspect", "create", "rm", "prune", "connect", "disconnect"]),
  system: new Set(["df", "prune", "info"]),
  builder: new Set(["prune", "du"]),
  compose: new Set([
    "ps",
    "logs",
    "config",
    "up",
    "down",
    "start",
    "stop",
    "restart",
    "pull",
    "build",
    "ls",
  ]),
});
const UNSAFE =
  /^--(privileged|pid|ipc|uts|userns|cgroupns|cap-add|security-opt|device)(=|$)|^--net(work)?=host$|docker\.sock/;
const DESTRUCTIVE = /^(rm|rmi|kill|prune|down)$/;

/**
 * Whether AI's command may run, and how it reads: { ok, why, changes, destructive, line }.
 * @param {unknown} args
 */
export function checkSuggested(args) {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    !args.every((a) => typeof a === "string" && !a.includes("\0"))
  )
    return {
      ok: false,
      why: "It is not a list of arguments.",
      changes: false,
      destructive: false,
      line: "",
    };
  const list = /** @type {string[]} */ (args[0] === "docker" ? args.slice(1) : args);
  const line = `docker ${list.join(" ")}`;
  const [first = "", second = ""] = list;
  const sub = GROUPS[first]
    ? (list.find((a, i) => i > 0 && !a.startsWith("-") && GROUPS[first]?.has(a)) ?? "")
    : "";
  const known = READS.has(first) || CHANGES.has(first) || (GROUPS[first] && sub !== "");
  if (!known)
    return {
      ok: false,
      why: `docker ${first} ${second} is not one the studio runs from a suggestion.`,
      changes: false,
      destructive: false,
      line,
    };
  if (
    list.some((a) => UNSAFE.test(a)) ||
    (list.includes("--network") && list[list.indexOf("--network") + 1] === "host") ||
    list.some(
      (a, i) => (a === "-v" || a === "--volume") && /^\/(?!Users|home|tmp)/.test(list[i + 1] ?? ""),
    )
  )
    return {
      ok: false,
      why: "It reaches into this computer (privileged, the host's network or files outside the home folder).",
      changes: true,
      destructive: true,
      line,
    };
  const verb = GROUPS[first] ? sub : first;
  return {
    ok: true,
    why: "",
    changes:
      !READS.has(first) &&
      ![
        "ls",
        "inspect",
        "logs",
        "history",
        "df",
        "ps",
        "config",
        "top",
        "stats",
        "port",
        "info",
        "du",
      ].includes(verb),
    destructive: DESTRUCTIVE.test(verb),
    line,
    args: list,
  };
}

/**
 * Ask, then run AI's command; resolves with what docker printed, or null when not run.
 * @param {import("./studio.js").App} app @param {string[]} args @param {string} title
 */
export async function runSuggested(app, args, title) {
  const check = checkSuggested(args);
  if (!check.ok || !check.args) {
    app.toast(check.why, "danger");
    return null;
  }
  const yes = await app.overlay.confirm({
    title: check.destructive ? `Run this? It removes or stops things.` : `Run this command?`,
    text: `${title}. AI suggested it; the studio runs it exactly as shown:`,
    ok: "Run",
    danger: check.destructive,
    detail: Object.assign(document.createElement("pre"), {
      className: "cmd-line confirm-cmd",
      textContent: check.line,
    }),
  });
  if (!yes) return null;
  try {
    const { stdout, stderr } = await app.docker(check.args, { timeoutMs: 0 });
    for (const name of ["containers", "images", "volumes", "networks", "projects", "disk"])
      void app.engine.load(/** @type {any} */ (name));
    return (stdout || stderr || "Done.").trim();
  } catch (error) {
    return `Failed: ${String(/** @type {any} */ (error)?.message ?? error)}`;
  }
}
