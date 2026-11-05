// The agent programs the plugin knows: how each one is found, asked one thing without its
// interactive screen, carried on in a conversation, given a model, and kept read-only. Data and pure
// functions only; nothing here runs a program.

/**
 * @typedef {"claude" | "codex" | "gemini" | "grok" | "text"} Format How a program's output reads.
 * @typedef {"flag" | "default" | "none"} Guard How read-only access is kept: by a flag the plugin
 *   passes, by the program's own default when no person can answer its prompts, or not at all.
 * @typedef {{ prompt: string, session?: string, model?: string, readOnly: boolean, plain?: boolean }} Ask
 *   `plain` asks for plain text, for a version that does not know the structured output flags.
 * @typedef {{
 *   id: string, name: string, vendor: string, command: string, install: string,
 *   format: Format, guard: Guard, guardNote: string, resumes: boolean,
 *   args(ask: Ask): string[]
 * }} Agent
 */

/** The longest prompt a program is handed as one argument (systems allow about 128 KiB per argument). */
export const PROMPT_LIMIT = 100_000;

/**
 * A prompt as one argument: no NUL (no program can receive it), never read as an option (a leading
 * dash gets a space before it), at most PROMPT_LIMIT characters.
 * @param {string} text
 */
export function promptArg(text) {
  const clean = text.replaceAll("\0", "").slice(0, PROMPT_LIMIT);
  return clean.startsWith("-") ? ` ${clean}` : clean;
}

const VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;

/** A model name or session id as a program may see it: no spaces, never an option. */
export function isValue(/** @type {unknown} */ value) {
  return typeof value === "string" && VALUE.test(value);
}

const model = (/** @type {Ask} */ ask, flag = "--model") =>
  ask.model && isValue(ask.model) ? [flag, ask.model] : [];
const session = (/** @type {Ask} */ ask) =>
  ask.session && isValue(ask.session) ? ask.session : "";

/** @type {readonly Agent[]} */
export const AGENTS = Object.freeze([
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    command: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
    format: "claude",
    guard: "flag",
    guardNote: "Runs with --permission-mode plan: it reads and answers, and changes nothing.",
    resumes: true,
    args: (ask) => [
      "-p",
      ...(ask.plain ? [] : ["--output-format", "stream-json", "--verbose"]),
      ...(ask.readOnly ? ["--permission-mode", "plan"] : []),
      ...model(ask),
      ...(session(ask) ? ["--resume", session(ask)] : []),
      promptArg(ask.prompt),
    ],
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    command: "codex",
    install: "npm install -g @openai/codex",
    format: "codex",
    guard: "flag",
    guardNote: "Runs with --sandbox read-only: commands it runs cannot write.",
    resumes: true,
    args: (ask) => [
      "exec",
      ...(ask.plain ? ["--color", "never"] : ["--json"]),
      "--skip-git-repo-check",
      ...(ask.readOnly ? ["--sandbox", "read-only"] : []),
      ...model(ask),
      ...(session(ask) ? ["resume", session(ask)] : []),
      promptArg(ask.prompt),
    ],
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    command: "gemini",
    install: "npm install -g @google/gemini-cli",
    format: "gemini",
    guard: "default",
    guardNote: "Without a person to approve, it leaves out every tool that needs approval.",
    resumes: false,
    args: (ask) => [
      ...(ask.plain ? [] : ["--output-format", "stream-json"]),
      ...model(ask),
      `--prompt=${promptArg(ask.prompt)}`,
    ],
  },
  {
    id: "grok",
    name: "Grok CLI",
    vendor: "xAI",
    command: "grok",
    install: "npm install -g @vibe-kit/grok-cli",
    format: "grok",
    guard: "none",
    guardNote: "Its headless mode may edit files and run commands; nothing holds it read-only.",
    resumes: false,
    args: (ask) => [...model(ask), `--prompt=${promptArg(ask.prompt)}`],
  },
  {
    id: "qwen",
    name: "Qwen Code",
    vendor: "Alibaba",
    command: "qwen",
    install: "npm install -g @qwen-code/qwen-code",
    format: "text",
    guard: "default",
    guardNote: "Without a person to approve, it leaves out every tool that needs approval.",
    resumes: false,
    args: (ask) => [...model(ask), `--prompt=${promptArg(ask.prompt)}`],
  },
  {
    id: "copilot",
    name: "Copilot CLI",
    vendor: "GitHub",
    command: "copilot",
    install: "npm install -g @github/copilot",
    format: "text",
    guard: "default",
    guardNote: "Without --allow-all-tools, which the plugin never passes, it may not use tools.",
    resumes: false,
    args: (ask) => [...model(ask), `--prompt=${promptArg(ask.prompt)}`],
  },
  {
    id: "cursor",
    name: "Cursor Agent",
    vendor: "Cursor",
    command: "cursor-agent",
    install: "curl https://cursor.com/install -fsS | bash",
    format: "claude",
    guard: "none",
    guardNote: "Its print mode has write access; nothing holds it read-only.",
    resumes: true,
    args: (ask) => [
      "-p",
      ...(ask.plain ? [] : ["--output-format", "stream-json"]),
      ...model(ask),
      ...(session(ask) ? ["--resume", session(ask)] : []),
      promptArg(ask.prompt),
    ],
  },
  {
    id: "opencode",
    name: "OpenCode",
    vendor: "SST",
    command: "opencode",
    install: "npm install -g opencode-ai",
    format: "text",
    guard: "none",
    guardNote: "Its run mode follows its own permission settings, which allow edits by default.",
    resumes: false,
    args: (ask) => ["run", ...model(ask), promptArg(ask.prompt)],
  },
]);

/** Every program the plugin may run, in the catalog's order (the manifest's proc:spawn list). */
export const COMMANDS = Object.freeze(AGENTS.map((agent) => agent.command));

export const AGENT_IDS = Object.freeze(AGENTS.map((agent) => agent.id));

/** The catalog entry with this id, or undefined. */
export function agentById(/** @type {unknown} */ id) {
  return AGENTS.find((agent) => agent.id === id);
}

/** The arguments that print the program's version. */
export const VERSION_ARGS = Object.freeze(["--version"]);

/**
 * The version a program printed: the first line with a dotted number, else the first line.
 * @param {string} stdout
 */
export function versionOf(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const found = /\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.-]+)?/.exec(line);
    if (found) return found[0];
  }
  return (lines[0] ?? "").slice(0, 40);
}

/**
 * A conversation's earlier turns as text before the new prompt, for programs that cannot resume a
 * session: the latest turns that fit in `limit` characters, oldest first.
 * @param {{ role: "user" | "agent", text: string }[]} turns
 * @param {string} prompt
 * @param {string} name The agent's name, for its own lines.
 * @param {number} [limit]
 */
export function withTranscript(turns, prompt, name, limit = 12_000) {
  /** @type {string[]} */
  const kept = [];
  let size = 0;
  for (const turn of [...turns].reverse()) {
    const line = `${turn.role === "user" ? "Me" : name}: ${turn.text.trim()}`;
    if (size + line.length > limit) break;
    kept.unshift(line);
    size += line.length + 2;
  }
  if (kept.length === 0) return prompt;
  return [
    "Our conversation so far:",
    "",
    kept.join("\n\n"),
    "",
    "Answer my new message, going on from the conversation above:",
    "",
    prompt,
  ].join("\n");
}
