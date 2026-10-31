// The palette's providers without a DOM, so vitest can test them: what each provider is asked as the
// person types (contributes.paletteProviders, specs/plugin/v0), which answers count, how they follow
// the commands, and desk.palette's own provider, the items search.

/** How many results a group shows, and what each provider is asked for. */
export const LIMIT = 5;
/** The shortest query, trimmed, that the providers are asked. */
export const SHORTEST = 2;
const LONGEST = 500;
const COMMAND = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const KIND = /^[a-z][a-z0-9-]*$/;

/**
 * @typedef {{ command: string, title: string, args?: Record<string, unknown> }} PaletteAction
 * @typedef {{ id: string, title: string, detail?: string, kind?: string, actions: PaletteAction[] }} PaletteResult
 * @typedef {{ query: string, limit: number }} PaletteQuery
 * @typedef {{ command: string, title: string }} Provider
 * @typedef {{ provider: string, title: string, results: PaletteResult[] }} Group
 * @typedef {{ type: "command", entry: unknown } |
 *   { type: "result", provider: string, group: string, result: PaletteResult }} Row
 */

/** What the providers are asked for a typed query, or undefined when it is too short. */
export function queryOf(/** @type {string} */ typed) {
  const query = typed.trim().slice(0, LONGEST);
  return query.length >= SHORTEST ? { query, limit: LIMIT } : undefined;
}

const text = (/** @type {unknown} */ v, min = 1) => typeof v === "string" && v.length >= min;
const object = (/** @type {unknown} */ v) =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** @returns {value is PaletteAction} */
function isAction(/** @type {any} */ value) {
  return (
    object(value) &&
    text(value.command) &&
    COMMAND.test(value.command) &&
    text(value.title) &&
    (value.args === undefined || object(value.args))
  );
}

/** @returns {value is PaletteResult} */
function isResult(/** @type {any} */ value) {
  return (
    object(value) &&
    text(value.id) &&
    text(value.title) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.kind === undefined || (text(value.kind) && KIND.test(value.kind))) &&
    Array.isArray(value.actions) &&
    value.actions.length >= 1 &&
    value.actions.length <= 8 &&
    value.actions.every(isAction)
  );
}

/**
 * Whether a provider answered PaletteResults: at most 50 results, each with an id, a title and one
 * to eight actions.
 * @returns {value is { results: PaletteResult[] }}
 */
export function isResults(/** @type {any} */ value) {
  return (
    object(value) &&
    Array.isArray(value.results) &&
    value.results.length <= 50 &&
    value.results.every(isResult)
  );
}

const capital = (/** @type {string} */ word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * An item as a result: Open in Desk (desk.item through desk.views.open), then Open the original
 * when it has a deepLink.
 * @param {import("@endue-ai/bridge").Item} item
 * @returns {PaletteResult}
 */
export function itemResult(item) {
  const { connector, instance } = item.source;
  /** @type {PaletteAction[]} */
  const actions = [
    {
      command: "desk.views.open",
      title: "Open in Desk",
      args: { id: "desk.item", params: { connector, instance, id: item.id } },
    },
  ];
  if (item.deepLink)
    actions.push({
      command: "desk.views.open-original",
      title: "Open the original",
      args: { url: item.deepLink },
    });
  return {
    id: `${connector}/${instance}/${item.id}`,
    title: item.title || item.id,
    detail: `${capital(item.kind)} · ${connector}`,
    kind: item.kind,
    actions,
  };
}

/**
 * desk.palette.items: a PaletteQuery answered from the index's full-text search.
 * @param {unknown} args
 * @param {(query: { text: string, limit: number }) => Promise<{ items: import("@endue-ai/bridge").Item[] }>} search
 */
export async function searchItems(args, search) {
  const { query, limit } = /** @type {{ query?: unknown, limit?: unknown }} */ (args ?? {});
  if (typeof query !== "string" || query.trim() === "")
    throw new Error("desk.palette.items needs a query");
  const n = typeof limit === "number" && Number.isInteger(limit) ? limit : LIMIT;
  const page = await search({ text: query.slice(0, LONGEST), limit: Math.min(Math.max(n, 1), 50) });
  return { results: page.items.map(itemResult) };
}

/** The action Enter runs on a result (the first), or Mod+Enter (the second, else the first). */
export function actionOf(/** @type {PaletteResult} */ result, /** @type {boolean} */ mod) {
  return (mod && result.actions[1]) || result.actions[0];
}

/**
 * Everything the palette lists, in order: the commands, then each group's results.
 * @param {unknown[]} commands
 * @param {Group[]} groups
 * @returns {Row[]}
 */
export function rows(commands, groups) {
  return [
    ...commands.map((entry) => /** @type {Row} */ ({ type: "command", entry })),
    ...groups.flatMap((group) =>
      group.results.map(
        (result) =>
          /** @type {Row} */ ({
            type: "result",
            provider: group.provider,
            group: group.title,
            result,
          }),
      ),
    ),
  ];
}

/**
 * Asks the providers of one opening at once whenever the trimmed query changes, two characters or
 * more; keeps each answer for the query still typed, and calls `changed` when the groups do. A
 * provider that fails or answers something that is not PaletteResults has no group.
 * @param {(command: string, query: PaletteQuery) => unknown} run
 * @param {() => void} changed
 */
export function createAsker(run, changed) {
  /** @type {Provider[]} */
  let providers = [];
  let asked = "";
  let turn = 0;
  /** @type {Map<string, PaletteResult[]>} */
  let answers = new Map();
  /** Forget what was asked and answered; true when there were groups to forget. */
  const forget = () => {
    turn += 1;
    asked = "";
    const had = answers.size > 0;
    answers = new Map();
    return had;
  };

  return {
    /** A new opening: these providers, nothing asked yet. */
    reset(/** @type {Provider[]} */ next = []) {
      providers = [...next];
      forget();
    },
    /** The person typed: ask again if the trimmed query changed. */
    ask(/** @type {string} */ typed) {
      const query = queryOf(typed);
      if ((query?.query ?? "") === asked) return;
      if (forget()) changed();
      if (!query) return;
      asked = query.query;
      const mine = turn;
      for (const provider of providers) {
        /** @type {Promise<unknown>} */
        let answer;
        try {
          answer = Promise.resolve(run(provider.command, { ...query }));
        } catch (error) {
          answer = Promise.reject(error);
        }
        answer.then(
          (value) => {
            if (mine !== turn || !isResults(value)) return;
            answers.set(provider.command, value.results.slice(0, query.limit));
            changed();
          },
          () => {},
        );
      }
    },
    /** The groups with results, in the providers' order. @returns {Group[]} */
    groups() {
      return providers.flatMap((p) => {
        const results = answers.get(p.command) ?? [];
        return results.length > 0 ? [{ provider: p.command, title: p.title, results }] : [];
      });
    },
  };
}
