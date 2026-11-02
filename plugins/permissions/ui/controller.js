// The permissions plugin without its DOM: it lists every caller's grants and revokes them, and it is
// the prompter, answering perm.prompt and an agent's perm.approval (ADR 0078) one card at a time. It
// only talks to the bridge and to a view, so the SDK's test host runs it with a recording view.
import { answeredLabel, approvalModel, resultModel } from "./approval.js";
import { describeCaller, describePermission, durationLabel } from "./describe.js";
import { grantList, parentOffer, promptModel } from "./model.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").CallerGrant} CallerGrant
 * @typedef {import("@endue-ai/bridge").GrantDuration} GrantDuration
 * @typedef {import("@endue-ai/bridge").PermPromptData} PermPromptData
 * @typedef {import("@endue-ai/bridge").PermApprovalData} PermApprovalData
 * @typedef {import("@endue-ai/bridge").PermApprovalDoneData} PermApprovalDoneData
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./model.js").GrantList} GrantList
 * @typedef {import("./model.js").PromptModel} PromptModel
 * @typedef {import("./approval.js").CardModel} CardModel
 * @typedef {{ grants(list: GrantList): void, prompt(model: PromptModel | null): void,
 *   approval(model: CardModel | null): void, status(text: string): void }} View
 * @typedef {"once" | "session" | "always" | "parent" | "refuse" | "task" | "deny" | "done" | "undo"}
 *   Choice
 * @typedef {{ kind: "prompt", data: PermPromptData } | { kind: "approval", data: PermApprovalData }
 *   | { kind: "result", data: PermApprovalData }} Card
 */

const MANAGE = { permission: "perm:manage" };
const PLUGINS = { permission: "plugin:manage" };
const SURFACE = { permission: "ui:surface" };
const CHANGES = { permission: "events:subscribe", names: ["perm.changed"] };
const DURATIONS = new Set(["once", "session", "always"]);
const APPROVALS = new Set(["once", "task", "deny"]);

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * @param {Pick<PluginContext, "bridge">} ctx
 * @param {View} view
 */
export function createPermissions({ bridge }, view) {
  /** @type {PluginInfo[]} */
  let plugins = [];
  /** The latest perm.list answer, null before the first one. @type {CallerGrant[] | null} */
  let grants = null;
  /**
   * Cards in arrival order; the first one is on screen: a prompt, an agent's call waiting for
   * approval, or what an allowed write did. @type {Card[]}
   */
  const queue = [];
  /** perm.approval.done of the writes approved on a card, by approval id. */
  const results = new Map();
  /** The writes waiting on a card, whose perm.approval.done the result card shows. */
  const writes = new Set();
  /**
   * The prompt surface while it is open or opening: its handle, or null when it could not open.
   * @type {Promise<string | null> | null}
   */
  let overlay = null;
  let answering = false;
  let listing = 0;

  const showGrants = () => {
    if (grants) view.grants(grantList(grants, plugins));
  };
  /** @param {Card} card @param {number} waiting @returns {PromptModel | CardModel} */
  const modelOf = (card, waiting) => {
    if (card.kind === "prompt") return promptModel(card.data, plugins, waiting);
    if (card.kind === "approval") return approvalModel(card.data, plugins, waiting);
    return resultModel(card.data, results.get(card.data.approvalId), plugins, waiting);
  };

  /** The card in front, in the dialog it belongs to; the other dialog closes first. */
  const showPrompt = () => {
    const [front] = queue;
    const waiting = queue.length - 1;
    if (front?.kind === "prompt") {
      view.approval(null);
      view.prompt(promptModel(front.data, plugins, waiting));
    } else {
      view.prompt(null);
      view.approval(front ? /** @type {CardModel} */ (modelOf(front, waiting)) : null);
    }
  };

  /** Show what is on screen again with fresh plugin names. */
  const showNames = () => {
    showGrants();
    if (queue.length > 0) showPrompt();
  };

  /** Names and kinds of installed plugins; without plugin:manage the ids stand in. */
  const loadPlugins = async () => {
    try {
      ({ plugins } = await bridge.call("plugin.list", { scope: PLUGINS }));
    } catch {
      plugins = [];
    }
  };

  const refresh = async () => {
    const mine = ++listing;
    try {
      const result = await bridge.call("perm.list", { scope: MANAGE });
      // A newer listing may have answered first; the latest call wins.
      if (mine !== listing) return;
      grants = result.grants;
      showGrants();
    } catch (error) {
      if (mine === listing) view.status(`Could not list permissions: ${codeOf(error)}.`);
    }
  };

  /** Other callers' perm.changed events reach only subscribers; refused, own changes still arrive. */
  const subscribe = () =>
    bridge.call("events.subscribe", { names: ["perm.changed"], scope: CHANGES }).catch(() => {});

  const raise = () => {
    overlay ??= bridge
      .call("ui.surface.open", { surface: "prompt", title: "Permission request", scope: SURFACE })
      .then(
        ({ handle }) => handle,
        // The prompt stays in this plugin's own frame.
        () => null,
      );
  };

  const lower = () => {
    const opened = overlay;
    overlay = null;
    void opened?.then((handle) => {
      if (handle) bridge.call("ui.surface.close", { handle, scope: SURFACE }).catch(() => {});
    });
  };

  /** @param {Card} card */
  const enqueue = (card) => {
    const id = (/** @type {Card} */ c) =>
      c.kind === "prompt" ? c.data.promptId : c.data.approvalId;
    if (queue.some((c) => c.kind === card.kind && id(c) === id(card))) return;
    queue.push(card);
    if (card.kind === "approval" && card.data.action === "fs.write") writes.add(id(card));
    raise();
    showPrompt();
  };

  /** @param {PermApprovalDoneData} done */
  const finished = (done) => {
    if (!writes.has(done.approvalId)) return;
    results.set(done.approvalId, done);
    const [front] = queue;
    if (front?.kind === "result" && front.data.approvalId === done.approvalId) showPrompt();
  };

  /**
   * The card in front is done with: the next one shows, or the overlay closes. The live region says
   * what happened and, when another card follows, what it is.
   * @param {string} said
   */
  const moveOn = (said) => {
    const [next] = queue;
    if (!next) lower();
    showPrompt();
    const title = next && next.kind !== "result" ? modelOf(next, 0).title : "";
    const text = [said, title && `Next: ${title}.`].filter(Boolean).join(" ");
    if (text) view.status(text);
  };

  /** @param {string} grantId */
  const revoke = async (grantId) => {
    const held = grants?.find((g) => g.grant.grantId === grantId);
    if (!held) return;
    const { label } = describePermission(held.grant.permission);
    const { name } = describeCaller(held.caller, plugins);
    try {
      await bridge.call("perm.revoke", { grantId, scope: MANAGE });
    } catch (error) {
      view.status(`Could not revoke ${label} from ${name}: ${codeOf(error)}.`);
      return;
    }
    view.status(`Revoked ${label} from ${name}.`);
    await refresh();
  };

  /**
   * Answer the prompt on screen. "parent" grants the parent folder the core offered instead, for the
   * duration asked. Any failure (decided, withdrawn or refused) still moves on, so the overlay never
   * traps the person.
   * @param {PermPromptData} prompt
   * @param {Choice} choice
   */
  const answerPrompt = async (prompt, choice) => {
    const parent = choice === "parent" ? parentOffer(prompt) : null;
    if (choice === "parent" ? !parent : choice !== "refuse" && !DURATIONS.has(choice)) return;
    answering = true;
    const granted = choice !== "refuse";
    const duration = parent ? prompt.duration : /** @type {GrantDuration} */ (choice);
    const { label } = describePermission(prompt.permission);
    const { name } = describeCaller(prompt.caller, plugins);
    const what = parent ? `${label} in all of ${parent.folder}` : label;
    let said;
    try {
      await bridge.call("perm.answer", {
        promptId: prompt.promptId,
        granted,
        ...(granted ? { duration } : {}),
        ...(parent ? { parent: true } : {}),
        scope: MANAGE,
      });
      said = granted
        ? `Allowed ${name}: ${what} (${durationLabel(duration)}).`
        : `Refused ${name}: ${label}.`;
    } catch (error) {
      said = `Could not answer ${name}: ${codeOf(error)}.`;
    }
    answering = false;
    queue.shift();
    // The dialog stays open for the next card; the live region says that it changed.
    moveOn(said);
  };

  /**
   * Answer an agent's call waiting for approval: once, for the rest of its task, or deny. An
   * allowed write leaves a card that shows what it wrote. Any failure still moves on.
   * @param {PermApprovalData} data
   * @param {Choice} choice
   */
  const approve = async (data, choice) => {
    if (!APPROVALS.has(choice) || (choice === "task" && !data.task)) return;
    const answer = /** @type {"once" | "task" | "deny"} */ (choice);
    answering = true;
    let said;
    let allowed = false;
    try {
      const params = { approvalId: data.approvalId, answer, scope: MANAGE };
      await bridge.call("perm.approve", params);
      said = answeredLabel(data, answer, plugins);
      allowed = answer !== "deny";
    } catch (error) {
      said = `Could not answer ${describeCaller(data.caller, plugins).name}: ${codeOf(error)}.`;
    }
    answering = false;
    queue.shift();
    if (allowed && writes.has(data.approvalId)) queue.unshift({ kind: "result", data });
    else writes.delete(data.approvalId);
    moveOn(said);
  };

  /**
   * Close the card an allowed write left, or take the write back first when the core can (Undo).
   * @param {PermApprovalData} data
   * @param {Choice} choice
   */
  const close = async (data, choice) => {
    const done = results.get(data.approvalId);
    const undo = choice === "undo" && done?.ok === true && done.undoable === true;
    if (!undo && choice !== "done") return;
    let said = "";
    if (undo) {
      answering = true;
      try {
        // cmd.undo (#276) takes back the desk's latest undoable action, this write.
        await /** @type {any} */ (bridge).call("cmd.undo", {});
        said = `Undid the write to ${data.target}.`;
      } catch (error) {
        said = `Could not undo the write to ${data.target}: ${codeOf(error)}.`;
      }
      answering = false;
    }
    results.delete(data.approvalId);
    writes.delete(data.approvalId);
    queue.shift();
    moveOn(said);
  };

  /**
   * Answer the card on screen with the person's choice.
   * @param {Choice} choice
   */
  const answer = async (choice) => {
    const [front] = queue;
    if (!front || answering) return;
    if (front.kind === "prompt") return answerPrompt(front.data, choice);
    if (front.kind === "approval") return approve(front.data, choice);
    return close(front.data, choice);
  };

  /**
   * Keys the plugin handles wherever focus is. Returns whether the key was used.
   * @param {string} key
   */
  const key = (key) => {
    const [front] = queue;
    if (key !== "Escape" || !front) return false;
    void answer(front.kind === "prompt" ? "refuse" : front.kind === "approval" ? "deny" : "done");
    return true;
  };

  bridge.onEvent((event) => {
    if (event.event === "perm.changed") void refresh();
    else if (event.event === "perm.prompt") enqueue({ kind: "prompt", data: event.data });
    else if (event.event === "perm.approval") enqueue({ kind: "approval", data: event.data });
    else if (event.event === "perm.approval.done") finished(event.data);
    else if (event.event === "plugin.changed") void loadPlugins().then(showNames);
  });

  const ready = (async () => {
    await Promise.all([loadPlugins(), subscribe()]);
    showNames();
    await refresh();
  })();

  return { ready, revoke, answer, key };
}
