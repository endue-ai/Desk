// The bounded, redacted request and response shapes returned by command handlers.
import { literalSecrets } from "./literals.js";
import {
  HIDDEN,
  hideFailure,
  hideText,
  hideUrl,
  hideValues,
  isSecretName,
  secretValues,
} from "./secret-names.js";
import { bodyText } from "./send.js";

/** @typedef {import("./app.js").Tab} Tab */
/** @typedef {import("./studio.js").Studio} Studio */
const MAX_TEXT = 20_000;

/** @param {Studio} S @param {Tab} tab */
export function commandSecrets(S, tab) {
  return [
    ...new Set([
      ...secretValues(S.scopes(tab)),
      ...(tab.sentSecrets ?? []),
      ...literalSecrets(tab.req)
        .map((entry) => entry.value)
        .filter(Boolean),
    ]),
  ].sort((a, b) => b.length - a.length);
}

/** @param {string} url @param {string[]} values */
export function safeUrl(url, values) {
  const masked = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/iu, `$1${HIDDEN}@`);
  return hideUrl(masked, values).slice(0, MAX_TEXT);
}

/** @param {Studio} S @param {Tab} tab */
export function requestData(S, tab) {
  const req = tab.req;
  const values = commandSecrets(S, tab);
  const safe = (/** @type {string} */ text) => hideText(text, values).slice(0, MAX_TEXT);
  /** @param {(import("./model.js").Pair & { secret?: boolean })[]} entries */
  const rows = (entries) =>
    entries.slice(0, 64).map(({ key, value, on, secret }) => ({
      key: safe(key),
      value: secret || isSecretName(key) ? HIDDEN : safe(value),
      on,
    }));
  const b = req.body;
  /** @type {Record<string, unknown>} */
  const body = { mode: b.mode };
  switch (b.mode) {
    case "none":
      break;
    case "form":
    case "multipart":
      body[b.mode] = rows(b[b.mode]);
      break;
    case "graphql":
      body.graphql = { query: safe(b.graphql.query), variables: safe(b.graphql.variables) };
      break;
    default:
      body[b.mode] = safe(b[b.mode]);
  }
  return {
    name: safe(req.name),
    method: req.method,
    url: safeUrl(req.url, values),
    params: rows(req.params),
    pathParams: rows(req.pathParams),
    headers: rows(req.headers),
    body,
    auth: req.auth.type,
  };
}

/** @param {Studio} S @param {Tab} tab */
export function responseData(S, tab) {
  const res = tab.response;
  if (!res) return null;
  const r = tab.results;
  const values = commandSecrets(S, tab);
  const held = tab.agent
    ? res.missing.filter((name) => S.scopes(tab).some((scope) => scope.secret?.has(name)))
    : [];
  return {
    status: res.status,
    reason: hideText(res.reason, values),
    error: res.error ? hideText(res.error, values) : null,
    ...(held.length
      ? {
          secretsNotFilled: held,
          note: "Secret variables are not filled in for a request given as a url. Send a saved request by name to use them.",
        }
      : {}),
    timeMs: Math.round(res.timings.total),
    size: res.size,
    headers: Object.fromEntries(
      res.headers
        .slice(0, 100)
        .map(([k, v]) => [
          hideValues(k, values),
          isSecretName(k)
            ? HIDDEN
            : /^location$/i.test(k)
              ? safeUrl(v, values)
              : hideText(v, values),
        ]),
    ),
    body: hideText(bodyText(res), values).slice(0, MAX_TEXT),
    tests: r
      ? {
          passed: [...r.tests, ...r.asserts].filter((t) => t.ok).length,
          failed: [
            ...r.tests.filter((t) => !t.ok).map((t) => hideText(`${t.name}: ${t.error}`, values)),
            ...r.asserts
              .filter((a) => !a.ok)
              .map((a) => hideFailure(a.target, `${a.target}: ${a.message}`, values)),
            ...r.errors.map((e) => hideText(`${e.from}: ${e.text}`, values)),
          ],
        }
      : null,
  };
}
