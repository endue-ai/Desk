// What the studio asks the brain, and the shape of each answer: a container diagnosed, logs
// explained, an image made smaller, a failed build explained, Docker files tailored, and any
// question about this engine. Prompts carry what docker says, cut to fit; variables' values never
// go (only their names), since they hold secrets. Pure.

import { clip } from "./ai-ask.js";
import { problemOf, stateLabel } from "./model.js";

const COMMAND = {
  type: "object",
  properties: {
    title: { type: "string", description: "What running it does, in a few words" },
    args: {
      type: "array",
      items: { type: "string" },
      description:
        'The docker command\'s arguments after `docker`, one per item, e.g. ["restart", "web"]',
    },
  },
  required: ["title", "args"],
  additionalProperties: false,
};

const FIX = {
  type: "object",
  properties: {
    title: { type: "string" },
    detail: {
      type: "string",
      description: "What to change and why, in two or three sentences; code in backticks",
    },
    command: COMMAND,
  },
  required: ["title", "detail"],
  additionalProperties: false,
};

export const TOOLS = {
  diagnose: {
    name: "diagnose_container",
    description: "Say why the container is in trouble and how to fix it.",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string", description: "The cause in one sentence" },
        cause: {
          type: "string",
          description: "What happened, from the evidence, in a short paragraph",
        },
        evidence: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "The log lines or facts that show it, quoted exactly",
        },
        fixes: { type: "array", items: FIX, maxItems: 4 },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["headline", "cause", "evidence", "fixes", "confidence"],
      additionalProperties: false,
    },
  },
  logs: {
    name: "explain_logs",
    description: "Explain what the log lines show and what needs attention.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        issues: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              severity: { type: "string", enum: ["error", "warning", "info"] },
              lines: { type: "array", items: { type: "string" }, maxItems: 3 },
              suggestion: { type: "string" },
            },
            required: ["title", "severity", "suggestion"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "issues"],
      additionalProperties: false,
    },
  },
  optimize: {
    name: "slim_image",
    description: "Suggest how to make the image smaller and faster to build.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        savings: { type: "string", description: 'A rough estimate, e.g. "about 150 MB"' },
        suggestions: { type: "array", maxItems: 5, items: FIX },
      },
      required: ["summary", "suggestions"],
      additionalProperties: false,
    },
  },
  build: {
    name: "explain_build_failure",
    description: "Say why the build failed and how to fix the Dockerfile or the context.",
    schema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        cause: { type: "string" },
        fixes: { type: "array", items: FIX, maxItems: 3 },
      },
      required: ["headline", "cause", "fixes"],
      additionalProperties: false,
    },
  },
  tailor: {
    name: "write_docker_files",
    description: "Give the Docker files for the project as described.",
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, content: { type: "string" } },
            required: ["name", "content"],
            additionalProperties: false,
          },
        },
        notes: { type: "string", description: "What was changed from the starting files and why" },
      },
      required: ["files", "notes"],
      additionalProperties: false,
    },
  },
  answer: {
    name: "answer",
    description: "Answer the question about this Docker engine.",
    schema: {
      type: "object",
      properties: {
        answer: {
          type: "string",
          description:
            "The answer in short paragraphs or a list; code and names in backticks; code blocks in triple backticks",
        },
        commands: {
          type: "array",
          items: COMMAND,
          maxItems: 4,
          description: "docker commands that do what the answer suggests, if any",
        },
      },
      required: ["answer"],
      additionalProperties: false,
    },
  },
};

const ROLE =
  "You are the assistant of Docker Studio, a client for the Docker engine. Be specific to the facts given; say when they are not enough. Suggest docker commands only with names that exist in the facts. Never print secrets.";

/** A container as facts: state, health, restarts, image, ports, mounts, networks, variable names. */
export function containerFacts(/** @type {import("./parse.js").Container} */ c) {
  const health = c.raw?.State?.Health;
  return [
    `Container ${c.name} (${c.id.slice(0, 12)}), image ${c.image}${c.project ? `, service ${c.service} of the Compose stack ${c.project}` : ""}.`,
    `State: ${stateLabel(c)}; exit code ${c.exitCode}; OOM killed: ${c.oom}; restarts: ${c.restarts}; restart policy: ${c.restartPolicy || "no"}.`,
    c.error ? `Engine error: ${c.error}` : "",
    `Started ${c.startedAt ? new Date(c.startedAt).toISOString() : "never"}; finished ${c.finishedAt ? new Date(c.finishedAt).toISOString() : "–"}.`,
    `Command: ${c.command || "(the image's)"}; workdir ${c.workdir || "/"}; user ${c.user || "root"}.`,
    `Ports: ${c.ports.map((p) => `${p.host}->${p.container}/${p.proto}`).join(", ") || "none published"}; exposed ${c.exposed.join(", ") || "none"}.`,
    `Mounts: ${c.mounts.map((m) => `${m.type} ${m.name || m.source} at ${m.destination}${m.rw ? "" : " (ro)"}`).join("; ") || "none"}.`,
    `Networks: ${c.networks.map((n) => `${n.name} ${n.ip}`).join(", ") || "none"}.`,
    `Environment variable names (values withheld): ${c.env.map((e) => e.split("=")[0]).join(", ")}.`,
    health
      ? `Health: ${health.Status}, failing streak ${health.FailingStreak}; last check output: ${clip(String(health.Log?.at(-1)?.Output ?? ""), 600)}`
      : "",
    c.labels["com.docker.compose.depends_on"]
      ? `Depends on: ${c.labels["com.docker.compose.depends_on"]}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** @param {import("./parse.js").Container} c @param {string[]} lines */
export function diagnosePrompt(c, lines) {
  return `${ROLE}\n\nDiagnose this container: ${problemOf(c)?.text ?? stateLabel(c)}.\n\n${containerFacts(c)}\n\nIts last log lines:\n${clip(lines.join("\n"), 14_000)}`;
}

/** @param {string} name @param {string[]} lines */
export function logsPrompt(name, lines) {
  return `${ROLE}\n\nExplain these log lines of ${name}: what is happening, what is wrong, what to do. Group repeated lines into one issue.\n\n${clip(lines.join("\n"), 20_000)}`;
}

/** @param {import("./parse.js").Image} image @param {import("./images.js").Layer[]} layers */
export function optimizePrompt(image, layers) {
  const rows = layers.map(
    (l, i) => `${i + 1}. ${l.size ? `${Math.round(l.size / 1e6)} MB` : "0 B"} ${l.by}`,
  );
  return `${ROLE}\n\nThe image ${image.refs[0] ?? image.id} is ${Math.round(image.size / 1e6)} MB, ${image.os}/${image.arch}. Its layers, oldest first:\n${clip(rows.join("\n"), 12_000)}\n\nSuggest Dockerfile changes that make it smaller (a smaller base, multi-stage, fewer files, caches cleaned in the same RUN, .dockerignore) and say roughly how much each saves.`;
}

/** @param {{ tag: string, error: string, context: string }} record @param {Array<{ name: string, status: string, output?: string[] }>} steps */
export function buildPrompt(record, steps) {
  const failed = steps.find((s) => s.status === "error");
  return `${ROLE}\n\nThe build of ${record.tag} in ${record.context} failed: ${record.error}\n\nSteps:\n${steps.map((s) => `- [${s.status}] ${s.name}`).join("\n")}\n\n${failed?.output?.length ? `Output of the failed step:\n${clip(failed.output.join("\n"), 8_000)}` : ""}`;
}

/** @param {string} description @param {Array<[string, string]>} files */
export function tailorPrompt(description, files) {
  return `${ROLE}\n\nThe project: ${description}\n\nAdapt these starting files to it, keeping what still fits. Return every file whole.\n\n${files.map(([n, c]) => `--- ${n}\n${c}`).join("\n")}`;
}

/** The engine as facts for a question: containers, stacks, images, volumes, disk. @param {any} state */
export function engineFacts(state) {
  const info = state.engine.info;
  const lines = [
    info
      ? `Engine ${info.server} on ${info.os} ${info.arch}, ${info.cpus} CPUs, ${Math.round(info.memory / 1e9)} GB memory, context ${state.context || info.context || "default"}.`
      : "No engine answers.",
    "Containers:",
    ...state.containers
      .slice(0, 60)
      .map(
        (/** @type {any} */ c) =>
          `- ${c.name}: ${stateLabel(c)}, image ${c.image}${c.project ? `, stack ${c.project}` : ""}${c.ports.length ? `, ports ${c.ports.map((/** @type {any} */ p) => `${p.host}->${p.container}`).join(" ")}` : ""}`,
      ),
    "Images:",
    ...state.images
      .slice(0, 40)
      .map(
        (/** @type {any} */ i) =>
          `- ${i.refs[0] ?? `<none> ${i.id.slice(7, 19)}`} ${Math.round(i.size / 1e6)} MB`,
      ),
    `Volumes: ${state.volumes
      .map((/** @type {any} */ v) => v.name)
      .slice(0, 40)
      .join(", ")}`,
    `Networks: ${state.networks.map((/** @type {any} */ n) => n.name).join(", ")}`,
    `Disk: ${state.disk.map((/** @type {any} */ d) => `${d.kind} ${Math.round(d.size / 1e6)} MB (${Math.round(d.reclaimable / 1e6)} MB reclaimable)`).join(", ")}`,
  ];
  return clip(lines.join("\n"), 14_000);
}

/** @param {string} question @param {any} state @param {string} focus What the person is looking at. */
export function answerPrompt(question, state, focus) {
  return `${ROLE}\n\nThe person asks: ${question}\n\n${focus ? `They are looking at: ${focus}\n\n` : ""}This engine now:\n${engineFacts(state)}`;
}
