// OAuth 2.0 tokens: a client-credentials or password grant posted to the token URL through the
// same curl engine, the access token and when it expires kept in the desk's store (never in a
// collection's files), and fetched again by itself before a request when it has run out.

import { base64, effectiveAuth } from "./auth.js";
import { bodyJson, formEncode, readResponse } from "./send.js";
import { resolve } from "./vars.js";

/**
 * @typedef {import("./model.js").Auth} Auth
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {{ token: string, type: string, expires: number | null, scope?: string, at: number }} Held
 */

/** The key a token is kept under: who asked where, for what. @param {Auth} auth @param {(t: string) => string} fill */
export function tokenKey(auth, fill) {
  const o = auth.oauth2;
  return [
    fill(o?.tokenUrl ?? ""),
    fill(o?.clientId ?? ""),
    fill(o?.scope ?? ""),
    o?.grant ?? "",
    fill(o?.username ?? ""),
  ].join("|");
}

/** The form a grant posts. @param {Auth} auth @param {(t: string) => string} fill */
export function grantBody(auth, fill) {
  const o = auth.oauth2;
  /** @type {[string, string][]} */
  const pairs = [["grant_type", o?.grant === "password" ? "password" : "client_credentials"]];
  if (o?.grant === "password")
    pairs.push(["username", fill(o.username ?? "")], ["password", fill(o.password ?? "")]);
  if (o?.scope) pairs.push(["scope", fill(o.scope)]);
  return pairs.map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`).join("&");
}

/** @param {Studio} S */
export function createTokens(S) {
  /** @type {Record<string, Held>} */
  let held = {};
  const save = () => S.ctx.bridge.call("store.set", { key: "oauth", value: held }).catch(() => {});

  /** @param {Tab} tab */
  const authOf = (tab) => effectiveAuth(tab.req.auth, S.parentAuth(tab)).auth;
  /** @param {Tab} tab */
  const fillFor = (tab) => (/** @type {string} */ text) => resolve(text, S.scopes(tab));

  /** Fetch a token for a tab's auth (its own or inherited), and keep it. @param {Tab} tab */
  const fetchToken = async (tab) => {
    const auth = authOf(tab);
    if (auth.type !== "oauth2" || !auth.oauth2)
      throw new Error("This request does not use OAuth 2.0.");
    const fill = fillFor(tab);
    const url = fill(auth.oauth2.tokenUrl).trim();
    if (!url) throw new Error("Set the token URL first.");
    const id = fill(auth.oauth2.clientId);
    const secret = fill(auth.oauth2.clientSecret);
    /** @type {import("./curl-config.js").Prepared} */
    const prep = {
      method: "POST",
      url,
      headers: [
        { key: "Content-Type", value: "application/x-www-form-urlencoded" },
        { key: "Accept", value: "application/json" },
        ...(id || secret
          ? [{ key: "Authorization", value: `Basic ${base64(`${id}:${secret}`)}` }]
          : []),
      ],
      body: { kind: "raw", text: grantBody(auth, fill) },
      settings: tab.req.settings,
    };
    const res = readResponse(await S.engine.send(prep, { verbose: false }).promise, prep, "", []);
    if (res.error) throw new Error(res.error);
    const json = /** @type {any} */ (bodyJson(res)?.value);
    if (res.status >= 400 || !json?.access_token)
      throw new Error(
        `The token URL answered ${res.status}${json?.error ? `: ${json.error}${json.error_description ? ` (${json.error_description})` : ""}` : ""}.`,
      );
    const now = Date.now();
    held[tokenKey(auth, fill)] = {
      token: String(json.access_token),
      type: String(json.token_type ?? "Bearer"),
      expires: typeof json.expires_in === "number" ? now + json.expires_in * 1000 : null,
      ...(json.scope ? { scope: String(json.scope) } : {}),
      at: now,
    };
    await save();
    return held[tokenKey(auth, fill)];
  };

  return {
    async start() {
      try {
        held = (await S.ctx.bridge.call("store.get", { key: "oauth" }))?.value ?? {};
      } catch {
        held = {};
      }
    },
    fetchToken,
    /** The token kept for a tab's auth. @param {Tab} tab */
    heldFor(tab) {
      const auth = authOf(tab);
      return auth.type === "oauth2" ? held[tokenKey(auth, fillFor(tab))] : undefined;
    },
    /** A lookup for prepare(): the live token of an auth, filled with a tab's scopes. @param {Tab} tab */
    lookup(tab) {
      const fill = fillFor(tab);
      return (/** @type {Auth} */ auth) => {
        const h = held[tokenKey(auth, fill)];
        return h && (h.expires === null || h.expires > Date.now()) ? h.token : "";
      };
    },
    /** Before a send: fetch a token when the request uses OAuth 2.0 and holds none that lives. @param {Tab} tab */
    async ensure(tab) {
      const auth = authOf(tab);
      if (auth.type !== "oauth2" || auth.oauth2?.token?.trim()) return;
      const h = held[tokenKey(auth, fillFor(tab))];
      if (h && (h.expires === null || h.expires > Date.now() + 5000)) return;
      if (!auth.oauth2?.tokenUrl) return;
      await fetchToken(tab);
    },
    /** Forget every token. */
    clear() {
      held = {};
      void save();
    },
  };
}
