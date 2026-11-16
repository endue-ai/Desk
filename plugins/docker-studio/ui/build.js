// Builds without DOM: the arguments of `docker build` from the Build form, every part checked, and
// a build's steps read from BuildKit's plain progress ("#5 [deps 2/2] RUN npm ci", its output
// lines, "#5 CACHED", "#5 DONE 12.3s", "#5 ERROR: …"), with the failure said at the end. Pure.

import { stripAnsi } from "./errors.js";
import { imageRef } from "./refs.js";

/**
 * @typedef {{ id: number, name: string, stage: string, status: "running" | "cached" | "done" | "error",
 *   seconds: number, output: string[] }} Step
 * @typedef {{ context: string, dockerfile: string, tag: string, target: string, platform: string,
 *   args: Array<{ key: string, value: string }>, noCache: boolean, pull: boolean }} BuildForm
 * @typedef {{ steps: Step[], error: string, image: string }} BuildModel
 */

const absolute = (/** @type {string} */ path, /** @type {string} */ what) => {
  if (!path.startsWith("/") || path.includes("\0"))
    throw new Error(`${what} ${JSON.stringify(path)} is not an absolute path.`);
  return path;
};

/** The arguments of `docker build` for a form. */
export function buildArgs(/** @type {BuildForm} */ f) {
  const context = absolute(f.context.trim(), "The build context");
  const args = ["build", "--progress", "plain"];
  if (f.dockerfile.trim()) args.push("--file", absolute(f.dockerfile.trim(), "The Dockerfile"));
  if (f.tag.trim()) args.push("--tag", imageRef(f.tag.trim()));
  if (f.target.trim()) {
    if (!/^[a-zA-Z0-9][\w.-]*$/.test(f.target.trim()))
      throw new Error(`The stage ${f.target} is not a stage name.`);
    args.push("--target", f.target.trim());
  }
  if (f.platform) {
    if (!/^[a-z0-9]+\/[a-z0-9]+(\/v\d)?(,[a-z0-9]+\/[a-z0-9]+(\/v\d)?)*$/.test(f.platform))
      throw new Error(`${f.platform} is not a platform like linux/amd64.`);
    args.push("--platform", f.platform);
  }
  for (const a of f.args) {
    if (!a.key.trim()) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a.key.trim()))
      throw new Error(`${a.key} is not a build argument name.`);
    args.push("--build-arg", `${a.key.trim()}=${a.value}`);
  }
  if (f.noCache) args.push("--no-cache");
  if (f.pull) args.push("--pull");
  return [...args, "--", context];
}

const STEP = /^#(\d+) (.*)$/;
const STAGE = /^\[(?:([\w.-]+) )?(\d+\/\d+)\] (.*)$/;
const TIMED = /^(\d+\.\d+) (.*)$/;

/** A build's model, filled one line at a time. @returns {BuildModel & { push(line: string): void }} */
export function createBuild() {
  /** @type {Map<number, Step>} */
  const steps = new Map();
  const model = {
    /** @type {Step[]} */
    steps: [],
    error: "",
    image: "",
    /** @param {string} raw */
    push(raw) {
      const line = stripAnsi(raw).trimEnd();
      const found = STEP.exec(line);
      if (!found) {
        if (/^ERROR:/i.test(line) || /failed to solve/i.test(line))
          model.error = line.replace(/^ERROR:\s*/i, "");
        return;
      }
      const id = Number(found[1]);
      const rest = found[2] ?? "";
      let step = steps.get(id);
      if (!step) {
        const stage = STAGE.exec(rest);
        step = {
          id,
          name: stage ? (stage[3] ?? rest) : rest,
          stage: stage ? `${stage[1] ? `${stage[1]} ` : ""}${stage[2]}` : "",
          status: "running",
          seconds: 0,
          output: [],
        };
        steps.set(id, step);
        model.steps.push(step);
        return;
      }
      if (rest === "CACHED") step.status = "cached";
      else if (/^DONE \d/.test(rest)) {
        step.status = "done";
        step.seconds = Number.parseFloat(rest.slice(5)) || 0;
      } else if (/^ERROR/.test(rest)) {
        step.status = "error";
        step.output.push(rest.replace(/^ERROR:?\s*/, ""));
      } else {
        const timed = TIMED.exec(rest);
        const text = timed ? (timed[2] ?? "") : rest;
        if (step.output.push(text) > 400) step.output.shift();
        const named = /naming to (\S+)/.exec(text);
        if (named) model.image = (named[1] ?? "").replace(/^docker\.io\/library\//, "");
      }
    },
  };
  return model;
}

/** How a build went, in a few words: "12 steps, 4 cached, 21.4 s". */
export function summary(/** @type {BuildModel} */ b) {
  const cached = b.steps.filter((s) => s.status === "cached").length;
  const seconds = b.steps.reduce((sum, s) => sum + s.seconds, 0);
  return `${b.steps.length} steps${cached ? `, ${cached} cached` : ""}${seconds ? `, ${seconds.toFixed(1)} s of work` : ""}`;
}

/** An empty form for a context folder. @returns {BuildForm} */
export function buildForm(context = "") {
  return {
    context,
    dockerfile: "",
    tag: "",
    target: "",
    platform: "",
    args: [],
    noCache: false,
    pull: false,
  };
}
