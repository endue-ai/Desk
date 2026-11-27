// Provider calls use the CLI's existing sign-in. Requests name the provider and repository explicitly,
// run outside the checkout and carry only fixed API paths and JSON fields.

import { readJob, readRelease, readRequest, readRun } from "./origin-model.js";

export const REQUEST_PAGE = 50;
const RUN_LIMIT = 12;
const RELEASE_LIMIT = 8;
const JOB_LIMIT = 50;

/** @param {import("./repo.js").Runner} runner @param {import("./origin-model.js").Origin} origin */
export function originApi(runner, origin) {
  const { program, host, path } = origin;
  const github = program === "gh";
  const repo = github ? `repos/${path}` : `projects/${encodeURIComponent(path)}`;
  const pulls = github ? "pulls" : "merge_requests";

  /**
   * @param {string} endpoint
   * @param {"GET" | "POST" | "PATCH" | "PUT" | "DELETE"} [method]
   * @param {Record<string, string | boolean>} [body]
   */
  async function api(endpoint, method = "GET", body) {
    const args = ["api", "--hostname", host, "--method", method, `${repo}/${endpoint}`];
    const options = { program, ...(body ? { input: JSON.stringify(body) } : {}) };
    if (body) args.push("--input", "-");
    const { stdout } = await run(args, options);
    if (!stdout.trim()) return null;
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`${program} returned an unreadable response. Refresh to try again.`);
    }
  }

  /** @param {string[]} args @param {import("./run.js").RunOptions} options */
  async function run(args, options) {
    try {
      return await runner.run(args, options);
    } catch (error) {
      const failed = /** @type {import("./run.js").GitError} */ (error);
      const detail = failed.outcome?.stderr ?? "";
      if (/\b401\b|(?:auth login|authentication required|not logged in)/i.test(detail)) {
        throw new Error(`Sign in with ${program} auth login for ${host}, then refresh.`);
      }
      if (/\b403\b|\b404\b/.test(detail)) {
        throw new Error(
          `${host} denied access or could not find this resource. Check the CLI account and repository permissions.`,
        );
      }
      throw error;
    }
  }

  return {
    async requests(/** @type {"open" | "all"} */ state, page = 1) {
      const filter =
        state === "open" ? (github ? "state=open&" : "state=opened&") : github ? "state=all&" : "";
      const order = github
        ? "sort=updated&direction=desc"
        : "scope=all&order_by=updated_at&sort=desc";
      const items = list(
        await api(`${pulls}?${filter}${order}&per_page=${REQUEST_PAGE}&page=${page}`),
      );
      return {
        items: items.map((item) => readRequest(origin, item)).filter((item) => item.number > 0),
        more: items.length === REQUEST_PAGE,
      };
    },
    async runs() {
      const payload = await api(`${github ? "actions/runs" : "pipelines"}?per_page=${RUN_LIMIT}`);
      return list(github ? payload?.workflow_runs : payload)
        .map((item) => readRun(origin, item))
        .filter((item) => item.id > 0);
    },
    async jobs(/** @type {import("./origin-model.js").Run} */ run) {
      const pipeline = github
        ? `actions/runs/${run.id}${run.attempt ? `/attempts/${run.attempt}` : ""}/jobs`
        : `pipelines/${run.id}/jobs`;
      const payload = await api(`${pipeline}?per_page=${JOB_LIMIT}`);
      const items = list(github ? payload?.jobs : payload);
      return {
        items: items.map((item) => readJob(origin, item)),
        more: github ? payload.total_count > items.length : items.length === JOB_LIMIT,
      };
    },
    async releases() {
      return list(await api(`releases?per_page=${RELEASE_LIMIT}`))
        .map((item) => readRelease(origin, item))
        .filter((item) => item.tag && (!github || item.id > 0));
    },
    createRequest(
      /** @type {{source: string, target: string, title: string, body: string}} */ fields,
    ) {
      const { source, target, title, body } = fields;
      return api(
        pulls,
        "POST",
        github
          ? { head: source, base: target, title, body }
          : { source_branch: source, target_branch: target, title, description: body },
      );
    },
    async changeRequest(
      /** @type {import("./origin-model.js").Request} */ request,
      /** @type {"close" | "reopen" | "merge"} */ action,
      /** @type {string} */ method = "merge",
      /** @type {() => void} */ checkTarget = () => {},
    ) {
      const endpoint = `${pulls}/${request.number}`;
      const current = readRequest(origin, await api(endpoint));
      if (
        current.state !== request.state ||
        current.source !== request.source ||
        current.target !== request.target ||
        current.sourceRepo !== request.sourceRepo ||
        current.targetRepo !== request.targetRepo ||
        (action === "merge" && current.sha !== request.sha)
      ) {
        throw new Error("The request changed after it was shown. Refresh and review it again.");
      }
      checkTarget();
      if (action === "merge") {
        if (current.state !== "Open" || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(current.sha))
          throw new Error("The request must be open and have a source commit before it can merge.");
        const result = await api(
          `${endpoint}/merge`,
          "PUT",
          github ? { sha: current.sha, merge_method: method } : { sha: current.sha },
        );
        if (github && result?.merged !== true)
          throw new Error(
            "GitHub did not merge the request. Check its branch rules and status checks.",
          );
        // GitLab can accept the merge before its worker changes the request state to merged.
        return result?.merged === true || result?.state === "merged" ? "merged" : "submitted";
      }
      return github
        ? api(endpoint, "PATCH", { state: action === "reopen" ? "open" : "closed" })
        : api(endpoint, "PUT", { state_event: action });
    },
    async publish(/** @type {{tag: string, title: string, notes: string}} */ fields) {
      const { tag, title, notes } = fields;
      if (github) {
        await run(
          [
            "release",
            "create",
            "--repo",
            `${host}/${path}`,
            "--verify-tag",
            "--title",
            title,
            "--notes-file",
            "-",
            "--",
            tag,
          ],
          { program, input: notes || "\n" },
        );
      } else {
        await api("releases", "POST", { tag_name: tag, name: title, description: notes });
      }
    },
    editRelease(
      /** @type {import("./origin-model.js").Release} */ release,
      /** @type {{title: string, notes: string}} */ fields,
    ) {
      const { title, notes } = fields;
      return github
        ? api(`releases/${release.id}`, "PATCH", { name: title, body: notes })
        : api(`releases/${encodeURIComponent(release.tag)}`, "PUT", {
            name: title,
            description: notes,
          });
    },
    deleteRelease(/** @type {import("./origin-model.js").Release} */ release) {
      return api(`releases/${github ? release.id : encodeURIComponent(release.tag)}`, "DELETE");
    },
  };
}

/** @param {unknown} payload @returns {any[]} */
function list(payload) {
  if (!Array.isArray(payload))
    throw new Error("The provider returned an unreadable list. Refresh to try again.");
  return payload;
}
