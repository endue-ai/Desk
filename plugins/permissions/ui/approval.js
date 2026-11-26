// The approval card (ADR 0078): an agent's irreversible call waiting for the person.
import { describeCaller, describePermission } from "./describe.js";

/**
 * @typedef {import("@endue-ai/bridge").PermApprovalData} PermApprovalData
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./describe.js").Caller} Caller
 * @typedef {"file" | "hunk" | "added" | "removed" | "same"} Change
 * @typedef {{ text: string, change: Change }} PreviewLine
 * @typedef {{ kind: string, lines: PreviewLine[], truncated: boolean }} Preview
 * @typedef {{ kind: "approval", approvalId: string, title: string, caller: Caller, action: string,
 *   target: string, preview: Preview | null, size: string, task: string | null, app: string | null,
 *   waiting: number }}
 *   ApprovalModel
 * @typedef {ApprovalModel} CardModel
 */

/** @type {Record<string, { verb: string, label: string }>} */
const ACTIONS = {
  "fs.write": { verb: "write a file", label: "Write a file" },
  "proc.spawn": { verb: "run a program", label: "Run a program" },
  "net.fetch": { verb: "send a web request", label: "Send a web request" },
  "cmd.invoke": { verb: "run a command", label: "Run a command" },
  "web.act": { verb: "operate a web page", label: "Operate the page at" },
  // Eris keeping a fact in the person's memory (ADR 0096): the card asks before she remembers.
  "memory.remember": { verb: "remember this", label: "Remember" },
  // An agent operating the computer (ADR 0123): the target is the app, the preview the act.
  "computer.input.click": { verb: "click", label: "Click in" },
  "computer.input.move": { verb: "move the pointer", label: "Move the pointer over" },
  "computer.input.drag": { verb: "drag", label: "Drag in" },
  "computer.input.scroll": { verb: "scroll", label: "Scroll in" },
  "computer.input.type": { verb: "type", label: "Type in" },
  "computer.input.keys": { verb: "press keys", label: "Press keys in" },
  "computer.ax.perform": { verb: "press a control", label: "Press a control in" },
  "computer.apps.launch": { verb: "open an app", label: "Open" },
  "computer.apps.activate": { verb: "switch apps", label: "Switch to" },
  "computer.apps.quit": { verb: "quit an app", label: "Quit" },
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
    "web.act": `its other actions in this view at ${data.target}`,
  }[data.action];
  // A computer act's task covers the same app: its other input to it.
  const app = data.action.startsWith("computer.") ? `its other input to ${data.target}` : null;
  const covered = what ?? app ?? `running ${data.target} again`;
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
    app: data.untilStopApp ? `Allow in ${data.untilStopApp} until I stop` : null,
    waiting,
  };
}

/**
 * What the status line says once the person answered.
 * @param {PermApprovalData} data
 * @param {import("@endue-ai/bridge").ApprovalAnswer} answer
 * @param {PluginInfo[]} plugins
 */
export function answeredLabel(data, answer, plugins) {
  const { name } = describeCaller(data.caller, plugins);
  const what = `${actionOf(data.action).label} ${data.target}`;
  if (answer === "deny") return `Denied ${name}: ${what}.`;
  if (answer === "task") return `Allowed ${name} for this task: ${what}.`;
  if (answer === "app") return `Allowed ${name} in ${data.untilStopApp} until you stop.`;
  return `Allowed ${name} once: ${what}.`;
}
