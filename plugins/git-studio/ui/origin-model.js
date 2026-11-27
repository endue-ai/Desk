// The origin identity and the small, provider-independent records the dashboard draws.

/**
 * @typedef {{ host: string, path: string, web: string, program: "gh" | "glab" }} Origin
 * @typedef {{ number: number, title: string, author: string, url: string, source: string,
 *   target: string, sourceRepo: string, targetRepo: string, sha: string, updated: string,
 *   state: "Open" | "Draft" | "Closed" | "Merged" | "Locked" }} Request
 * @typedef {{ id: number, name: string, ref: string, sha: string, status: string, date: string,
 *   url: string, attempt?: number }} Run
 * @typedef {{ id: number, name: string, status: string, stage: string, url: string,
 *   started: string, finished: string }} Job
 * @typedef {{ id: number, tag: string, name: string, notes: string, date: string, url: string,
 *   state: "Draft" | "Prerelease" | "Published" | "Upcoming" }} Release
 * @typedef {{ request: Request, children: Stack[] }} Stack
 */

/** Only known provider hosts. A Git remote must never choose an arbitrary API host for a CLI token.
 * @returns {Origin | null}
 */
export function parseOrigin(/** @type {string | undefined} */ remote) {
  if (!remote || /[\r\n]/.test(remote)) return null;
  const scp = /^(?:[^/@:\s]+@)?([\w.-]+):([^/].*)$/.exec(remote);
  let address;
  try {
    address = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote);
  } catch {
    return null;
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(address.protocol)) return null;
  const host = address.hostname.toLowerCase();
  const program = host === "github.com" ? "gh" : host === "gitlab.com" ? "glab" : null;
  if (!program) return null;
  const path = address.pathname
    .replace(/^\//, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const parts = path.split("/");
  if (
    address.search ||
    address.hash ||
    (address.port && (address.protocol === "http:" || address.protocol === "https:")) ||
    parts.length < 2 ||
    (program === "gh" && parts.length !== 2) ||
    parts.some((part) => !/^[\w.-]+$/.test(part) || part === "." || part === "..")
  )
    return null;
  return { host, path, web: `https://${host}/${path}`, program };
}

/** Accept only HTTPS links on the selected provider's host. */
export function originLink(/** @type {Origin} */ origin, /** @type {unknown} */ value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.origin === `https://${origin.host}` && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** @returns {Request} */
export function readRequest(/** @type {Origin} */ origin, /** @type {any} */ item) {
  const github = origin.program === "gh";
  const closed = item.state === "closed";
  const merged = item.merged_at || item.state === "merged";
  const draft = item.draft || item.work_in_progress;
  return {
    number: id(github ? item.number : item.iid),
    title: str(item.title),
    author: str(item.user?.login ?? item.author?.username),
    url: originLink(origin, item.html_url ?? item.web_url),
    source: str(github ? item.head?.ref : item.source_branch),
    target: str(github ? item.base?.ref : item.target_branch),
    sourceRepo: github
      ? str(item.head?.repo?.full_name).toLowerCase()
      : project(item.source_project_id),
    targetRepo: github
      ? str(item.base?.repo?.full_name).toLowerCase()
      : project(item.target_project_id),
    sha: str(github ? item.head?.sha : item.sha),
    updated: str(item.updated_at),
    state: merged
      ? "Merged"
      : closed
        ? "Closed"
        : item.state === "locked"
          ? "Locked"
          : draft
            ? "Draft"
            : "Open",
  };
}

/** @returns {Run} */
export function readRun(/** @type {Origin} */ origin, /** @type {any} */ item) {
  return {
    id: id(item.id),
    name: str(item.name || item.workflow_name) || `Pipeline #${item.iid || item.id}`,
    ref: str(item.head_branch ?? item.ref),
    sha: str(item.head_sha ?? item.sha),
    status: str(item.conclusion || item.status),
    date: str(item.updated_at ?? item.created_at),
    url: originLink(origin, item.html_url ?? item.web_url),
    attempt: id(item.run_attempt) || undefined,
  };
}

/** @returns {Job} */
export function readJob(/** @type {Origin} */ origin, /** @type {any} */ item) {
  return {
    id: id(item.id),
    name: str(item.name),
    stage: str(item.stage),
    status: str(item.conclusion || item.status),
    url: originLink(origin, item.html_url ?? item.web_url),
    started: str(item.started_at),
    finished: str(item.completed_at ?? item.finished_at),
  };
}

/** @returns {Release} */
export function readRelease(/** @type {Origin} */ origin, /** @type {any} */ item) {
  const tag = str(item.tag_name);
  return {
    id: id(item.id),
    tag,
    name: str(item.name) || tag,
    notes: str(item.body ?? item.description),
    date: str(item.published_at ?? item.released_at ?? item.created_at),
    state: item.draft
      ? "Draft"
      : item.prerelease
        ? "Prerelease"
        : Date.parse(item.released_at) > Date.now()
          ? "Upcoming"
          : "Published",
    url: originLink(origin, item.html_url ?? item._links?.self),
  };
}

/**
 * A request targeting another request's source is its prerequisite. Keep ambiguous paths and cycles
 * visible as independent rows, and use the repository identity as well as the branch name for forks.
 * @param {Request[]} requests @returns {Stack[]}
 */
export function stackRequests(requests) {
  const nodes = requests.map((request) => ({ request, children: /** @type {Stack[]} */ ([]) }));
  /** @type {Map<string, Stack[]>} */
  const sources = new Map();
  /** @type {Map<Stack, Stack>} */
  const parents = new Map();
  for (const node of nodes) {
    const { sourceRepo, source } = node.request;
    if (!sourceRepo || !source || !isOpen(node.request)) continue;
    const key = `${sourceRepo}:${source}`;
    const list = sources.get(key) ?? [];
    list.push(node);
    sources.set(key, list);
  }
  for (const node of nodes) {
    if (!isOpen(node.request)) continue;
    const { targetRepo, target } = node.request;
    const matches = sources.get(`${targetRepo}:${target}`);
    if (matches?.length === 1 && matches[0] && matches[0] !== node) parents.set(node, matches[0]);
  }
  /** @type {Stack[]} */
  const roots = [];
  for (const node of nodes) {
    const seen = new Set([node]);
    let ancestor = parents.get(node);
    while (ancestor && !seen.has(ancestor)) {
      seen.add(ancestor);
      ancestor = parents.get(ancestor);
    }
    const parent = parents.get(node);
    if (parent && !ancestor) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function isOpen(/** @type {Request} */ request) {
  return request.state === "Open" || request.state === "Draft";
}

export function statusTone(/** @type {string} */ status) {
  if (["success", "merged", "published"].includes(status.toLowerCase())) return "success";
  if (["failure", "failed", "timed_out", "startup_failure", "action_required"].includes(status))
    return "danger";
  if (
    [
      "in_progress",
      "running",
      "pending",
      "queued",
      "waiting",
      "preparing",
      "scheduled",
      "manual",
      "created",
    ].includes(status)
  )
    return "warning";
  return "info";
}

const str = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");
const id = (/** @type {number} */ value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
const project = (/** @type {number} */ value) => (id(value) ? String(value) : "");
