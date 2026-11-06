// GitHub: an issue or a pull request as GitHub's search API returns it (`node_id`, `number`, `state`,
// `labels`, `assignee`, `milestone { title, due_on }`, `repository_url`, `html_url`, and
// `pull_request` and `draft` on a pull request), kept whole in the item's `raw` by desk.github (an
// http connector, ADR 0106). GitHub has no workflow status: open, draft, in review, closed, merged.
import { dateOf, namesOf, objectOf, textOf } from "./common.js";

/**
 * @typedef {import("./common.js").Work} Work
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 */

/** Whether an item comes from GitHub: its connector says so, or its raw is a GitHub issue. */
export function detect(/** @type {TaskItem} */ item) {
  if (/github/i.test(item.source.connector)) return true;
  const raw = objectOf(item.raw);
  return Boolean(
    raw &&
      typeof raw.node_id === "string" &&
      typeof raw.repository_url === "string" &&
      /\/repos\//.test(raw.repository_url),
  );
}

/** owner/repo from the record's repository_url. */
const repositoryOf = (/** @type {Record<string, any>} */ raw) =>
  typeof raw.repository_url === "string" ? raw.repository_url.split("/repos/")[1] : undefined;

/** A pull request's or an issue's state as a board names it, and its category. */
function stateOf(/** @type {Record<string, any>} */ raw, /** @type {boolean} */ pull) {
  if (raw.state === "closed") {
    const merged = pull && typeof objectOf(raw.pull_request)?.merged_at === "string";
    return { status: merged ? "Merged" : "Closed", category: /** @type {const} */ ("done") };
  }
  if (!pull) return { status: "Open", category: /** @type {const} */ ("todo") };
  return {
    status: raw.draft === true ? "Draft" : "In review",
    category: /** @type {const} */ ("doing"),
  };
}

/** @returns {Partial<Work>} */
export function adapt(/** @type {TaskItem} */ item) {
  const raw = objectOf(item.raw) ?? {};
  const pull = objectOf(raw.pull_request) !== undefined;
  const repository = repositoryOf(raw) ?? item.project;
  const name = repository?.split("/")[1];
  const login = textOf(objectOf(raw.assignee)?.login);
  const milestone = objectOf(raw.milestone);
  return {
    system: "github",
    ref: name && typeof raw.number === "number" ? `${name}#${raw.number}` : "",
    url: item.deepLink ?? (typeof raw.html_url === "string" ? raw.html_url : undefined),
    ...stateOf(raw, pull),
    type: pull ? "Pull request" : "Issue",
    ...(login ? { assignee: { name: login } } : {}),
    labels: namesOf(raw.labels),
    project: repository,
    sprint: textOf(milestone?.title),
    due: dateOf(milestone?.due_on) ?? dateOf(item.due),
    createdAt: typeof raw.created_at === "string" ? raw.created_at : undefined,
    completedAt: typeof raw.closed_at === "string" ? raw.closed_at : undefined,
  };
}
