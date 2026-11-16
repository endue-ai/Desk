// What the studio does with a request: send it (with the hooks other features add before and
// after: scripts, captured values, assertions, tests), cancel it, copy it as curl, duplicate,
// rename, close, and the small things the response pane asks for (copy, save, clear).

import { curlCommand } from "./curl-config.js";
import { copyText, h } from "./dom.js";
import { EngineError } from "./engine.js";
import { ask, confirm } from "./menu.js";
import { clone, newRequest } from "./model.js";
import { prepare, readResponse } from "./send.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./send.js").Response} Response
 * @typedef {{ before?(S: Studio, tab: Tab): Promise<void> | void,
 *   prepared?(S: Studio, tab: Tab, prep: import("./curl-config.js").Prepared): Promise<void> | void,
 *   after?(S: Studio, tab: Tab, res: Response): Promise<void> | void }} SendHook
 */

/** Hooks other features add around a send, run in the order added. @type {SendHook[]} */
export const SEND_HOOKS = [];

/** A response that never reached a server. @param {string} error @param {string[]} [missing] @returns {Response} */
export function failure(error, missing = []) {
  return {
    status: 0,
    reason: "",
    version: "",
    headers: [],
    body: new Uint8Array(),
    contentType: "",
    size: 0,
    headerSize: 0,
    timings: { dns: 0, tcp: 0, tls: 0, wait: 0, download: 0, redirect: 0, total: 0 },
    hops: [],
    timeline: [],
    sent: { method: "", url: "", headers: [], body: "" },
    remote: "",
    httpVersion: "",
    error,
    at: Date.now(),
    missing,
  };
}

/** The context prepare() needs for a tab: its scopes and what its folders give it. @param {Studio} S @param {Tab} tab */
export function sendContext(S, tab) {
  return {
    scopes: S.scopes(tab),
    parentAuth: S.parentAuth(tab),
    parentHeaders: S.parentHeaders(tab),
  };
}

/** @param {Studio} S */
export function createActions(S) {
  const { app } = S;

  /** @param {Tab} tab */
  const send = async (tab) => {
    if (tab.running) return;
    if (!tab.req.url.trim()) {
      app.toast("Type a URL first.", "error");
      S.focusUrl();
      return;
    }
    const placeholder = { cancel: () => {} };
    tab.running = placeholder;
    tab.response = undefined;
    app.emit("sending", tab);
    /** @type {Response} */
    let res;
    try {
      for (const hook of SEND_HOOKS) await hook.before?.(S, tab);
      const { prep, missing, bodyText } = prepare(tab.req, sendContext(S, tab));
      for (const hook of SEND_HOOKS) await hook.prepared?.(S, tab, prep);
      if (tab.running !== placeholder) return;
      const running = S.engine.send(prep, { verbose: true });
      tab.running = running;
      res = readResponse(await running.promise, prep, bodyText, missing);
    } catch (error) {
      const text =
        error instanceof EngineError
          ? error.message
          : `The request could not be made: ${String(/** @type {Error} */ (error)?.message ?? error)}`;
      res = failure(text);
    }
    tab.running = undefined;
    tab.response = res;
    for (const hook of SEND_HOOKS) {
      try {
        await hook.after?.(S, tab, res);
      } catch (error) {
        console.warn("api-studio: after-send hook failed", error);
      }
    }
    if (!res.cancelled) app.remember(tab, res);
    app.emit("sending", tab);
    app.emit("response", tab);
  };

  /** @param {Tab} tab */
  const cancel = (tab) => {
    tab.running?.cancel();
  };

  /** @param {Tab} tab */
  const copyCurl = async (tab) => {
    const { prep, missing } = prepare(tab.req, sendContext(S, tab));
    await S.copy(
      curlCommand(prep),
      missing.length ? `Copied; not defined: ${missing.join(", ")}` : "Copied as curl",
    );
  };

  /** @param {string} text @param {string} [said] */
  const copy = async (text, said = "Copied") => {
    app.toast((await copyText(text)) ? said : "The clipboard is not available here.", "ok");
  };

  /** @param {Tab} tab */
  const duplicate = (tab) => {
    const req = clone(tab.req);
    req.id = newRequest().id;
    req.name = `${tab.req.name} copy`;
    app.open(req);
  };

  /** @param {Tab} tab */
  const rename = async (tab) => {
    const name = await ask("Rename request", "Name", tab.req.name, "Rename");
    if (!name) return;
    tab.req.name = name;
    app.emit("req", { field: "name" });
  };

  /** @param {Tab} tab */
  const closeTab = async (tab) => {
    if (app.dirty(tab)) {
      const choice = await S.askUnsaved(tab);
      if (choice === undefined) return;
      if (choice === "save" && !(await S.save(tab))) return;
    }
    app.close(tab.id);
  };

  /** @param {Tab} tab */
  const clearResponse = (tab) => {
    tab.response = undefined;
    app.emit("response", tab);
  };

  /** Save the body to a file the person picks. @param {Tab} tab */
  const saveBody = async (tab) => {
    const res = tab.response;
    if (!res) return;
    const type = res.contentType.split(";")[0]?.trim() ?? "";
    const ext = /json/.test(type)
      ? "json"
      : /html/.test(type)
        ? "html"
        : /xml/.test(type)
          ? "xml"
          : (/^image\/(\w+)/.exec(type)?.[1] ?? "txt");
    const name = `${(tab.req.name || "response").replace(/[^\w.-]+/g, "-").toLowerCase()}.${ext}`;
    try {
      const chosen = await S.ctx.bridge.call("dialog.save", {
        title: "Save the response body",
        suggestedName: name,
      });
      if (!chosen?.path || chosen.cancelled) return;
      let bin = "";
      for (let i = 0; i < res.body.length; i += 8192)
        bin += String.fromCharCode(...res.body.subarray(i, i + 8192));
      await S.ctx.bridge.call("fs.write", {
        path: chosen.path,
        content: btoa(bin),
        encoding: "base64",
        scope: { permission: "fs:write", paths: [chosen.path] },
      });
      app.toast(`Saved to ${chosen.path}`, "ok");
    } catch (error) {
      app.toast(`Could not save: ${String(/** @type {any} */ (error)?.message ?? error)}`, "error");
    }
  };

  /** Ask whether to save a tab before closing it: "save", "discard" or undefined to stay. @param {Tab} tab */
  const askUnsaved = async (tab) => {
    const { dialog } = await import("./menu.js");
    return dialog({
      title: "Save changes?",
      body: h("p.as-dialog-text", null, `“${tab.req.name}” has changes that are not saved.`),
      actions: [
        { label: "Cancel", value: () => undefined },
        { label: "Don't save", kind: "desk-btn-danger", value: () => "discard" },
        { label: "Save", kind: "desk-btn-primary", value: () => "save" },
      ],
    });
  };

  /** @param {import("./app.js").HistoryEntry} entry */
  const openHistory = (entry) => {
    const req = clone(entry.req);
    req.id = newRequest().id;
    app.open(req);
  };

  return {
    send,
    cancel,
    copyCurl,
    copy,
    duplicate,
    rename,
    closeTab,
    clearResponse,
    saveBody,
    askUnsaved,
    openHistory,
    confirm,
  };
}
