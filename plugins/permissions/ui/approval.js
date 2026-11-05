// The approval card (ADR 0078): an agent's irreversible call waiting for the person, and, once an
// allowed write ran, what it wrote. Plain data in, plain data out, like model.js.
import { describeCaller, describePermission } from "./describe.js";

/**
 * @typedef {import("@endue-ai/bridge").PermApprovalData} PermApprovalData
 * @typedef {import("@endue-ai/bridge").PermApprovalDoneData} PermApprovalDoneData
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./describe.js").Caller} Caller
 * @typedef {"file" | "hunk" | "added" | "removed" | "same"} Change
 * @typedef {{ text: string, change: Change }} PreviewLine
 * @typedef {{ kind: string, lines: PreviewLine[], truncated: boolean }} Preview
 * @typedef {{ kind: "approval", approvalId: string, title: string, caller: Caller, action: string,
 *   target: string, preview: Preview | null, size: string, task: string | null, waiting: number }}
 *   ApprovalModel
 * @typedef {{ kind: "result", approvalId: string, title: string, caller: Caller, text: string,
 *   undo: boolean, waiting: number }} ResultModel
 * @typedef {ApprovalModel | ResultModel} CardModel
 */

/** @type {Record<string, { verb: string, label: string }>} */
const ACTIONS = {
  "fs.write": { verb: "write a file", label: "Write a file" },
  "proc.spawn": { verb: "run a program", label: "Run a program" },
  "net.fetch": { verb: "send a web request", label: "Send a web request" },
  "cmd.invoke": { verb: "run a command", label: "Run a command" },
  // Eris keeping a fact in the person's memory (ADR 0096): the card asks before she remembers.
  "memory.remember": { verb: "remember this", label: "Remember this?" },
};

const actionOf = (/** @type {string} */ action) =>
  ACTIONS[action] ?? { verb: action, label: action };

/**
 * A size in bytes, in words: "1 byte", "21 bytes", "1.5 KB", "3.2 MB".
 * @param {number} bytes
 */
export function sizeLabel(bytes) {
  if (bytes === 1) return "1 byte";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The preview's text as lines, each marked with what it is: a diff's file names, hunk headers,
 * added, removed and unchanged lines; any other preview's lines are unchanged text.
 * @param {PermApprovalData["preview"]} preview
 * @returns {Preview | null}
 */
export function previewOf(preview) {
  if (!preview) return null;
  const lines = preview.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  /** @type {(line: string, index: number) => Change} */
  const change = (line, index) => {
    if (preview.kind !== "diff") return "same";
    if (index < 2) return "file";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+")) return "added";
    if (line.startsWith("-")) return "removed";
    return "same";
  };
  return {
    kind: preview.kind,
    lines: lines.map((text, index) => ({ text, change: change(text, index) })),
    truncated: preview.truncated === true,
  };
}

/**
 * What "Allow for this task" lets through, in words; null when the call belongs to no task.
 * @param {PermApprovalData} data
 */
function taskLabel(data) {
  if (!data.task) return null;
  const { scope } = describePermission(data.permission);
  const what = {
    "fs.write": `its other writes in ${scope}`,
    "net.fetch": `its other requests to ${scope}`,
    "memory.remember": "the other facts it keeps",
  }[data.action];
  const covered = what ?? `running ${data.target} again`;
  return `Allow for this task: ${covered} until this turn ends.`;
}

/**
 * The card for an agent's call waiting for approval, with how many cards wait behind it.
 * @param {PermApprovalData} data
 * @param {PluginInfo[]} plugins
 * @param {number} waiting
 * @returns {ApprovalModel}
 */
export function approvalModel(data, plugins, waiting) {
  const caller = describeCaller(data.caller, plugins);
  const { verb, label } = actionOf(data.action);
  return {
    kind: "approval",
    approvalId: data.approvalId,
    title: `${caller.name} wants to ${verb}`,
    caller,
    action: label,
    target: data.target,
    preview: previewOf(data.preview),
    size: data.size === undefined ? "" : sizeLabel(data.size),
    task: taskLabel(data),
    waiting,
  };
}

/**
 * The card an allowed write leaves: writing, what it wrote, or why it failed. Undo only when the
 * core says it can take the write back (cmd.undo, #276).
 * @param {PermApprovalData} data
 * @param {PermApprovalDoneData | undefined} done
 * @param {PluginInfo[]} plugins
 * @param {number} waiting
 * @returns {ResultModel}
 */
export function resultModel(data, done, plugins, waiting) {
  const caller = describeCaller(data.caller, plugins);
  const card = { kind: /** @type {const} */ ("result"), approvalId: data.approvalId, caller };
  if (!done) {
    const title = `${caller.name} is writing a file`;
    return { ...card, title, text: `Writing ${data.target}…`, undo: false, waiting };
  }
  if (!done.ok) {
    const why = done.error?.message ?? "it failed";
    const title = `${caller.name} could not write a file`;
    return {
      ...card,
      title,
      text: `Could not write ${data.target}: ${why}.`,
      undo: false,
      waiting,
    };
  }
  const size = sizeLabel(done.bytesWritten ?? data.size ?? 0);
  const text = `Wrote ${size} to ${data.target}.`;
  return {
    ...card,
    title: `${caller.name} wrote a file`,
    text,
    undo: done.undoable === true,
    waiting,
  };
}

/**
 * What the status line says once the person answered.
 * @param {PermApprovalData} data
 * @param {"once" | "task" | "deny"} answer
 * @param {PluginInfo[]} plugins
 */
export function answeredLabel(data, answer, plugins) {
  const { name } = describeCaller(data.caller, plugins);
  const what = `${actionOf(data.action).label} ${data.target}`;
  if (answer === "deny") return `Denied ${name}: ${what}.`;
  if (answer === "task") return `Allowed ${name} for this task: ${what}.`;
  return `Allowed ${name} once: ${what}.`;
}
