// What the agent programs print, in the shapes their non-interactive modes use: Claude Code's
// stream-json, Codex's exec --json (the 0.44+ thread and item events and the older msg events),
// Gemini CLI's stream-json and json, Grok CLI's headless JSON lines, Cursor Agent's stream-json.

const lines = (...objects: unknown[]) => `${objects.map((o) => JSON.stringify(o)).join("\n")}\n`;

export const VERSIONS: Record<string, string> = {
  claude: "2.0.14 (Claude Code)\n",
  codex: "codex-cli 0.46.0\n",
  gemini: "0.9.0\n",
  grok: "1.0.1\n",
  qwen: "0.0.14\n",
  copilot: "0.0.339\nCommit: 1a2b3c4\n",
  "cursor-agent": "2025.09.18-7ae6800\n",
  opencode: "0.14.1\n",
};

export const CLAUDE_STREAM = lines(
  {
    type: "system",
    subtype: "init",
    session_id: "5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d",
    model: "claude-sonnet-4-5",
    cwd: "/home/me/project",
    tools: ["Read", "Grep"],
  },
  {
    type: "assistant",
    message: { id: "msg_1", content: [{ type: "text", text: "Let me look at the file." }] },
    session_id: "5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d",
  },
  {
    type: "assistant",
    message: {
      id: "msg_1",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b.ts" } }],
    },
  },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } },
  {
    type: "assistant",
    message: { id: "msg_2", content: [{ type: "text", text: "It exports **two** functions." }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "It exports **two** functions.",
    session_id: "5f1c2b9e-0d4c-4b8e-9a61-3c2e1f0a7b6d",
    total_cost_usd: 0.0123,
    usage: { input_tokens: 1200, output_tokens: 34 },
    duration_ms: 3200,
  },
);

export const CLAUDE_ERROR = lines(
  { type: "system", subtype: "init", session_id: "s-err", model: "claude-sonnet-4-5" },
  {
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "Invalid API key · Please run /login",
    session_id: "s-err",
  },
);

export const CODEX_STREAM = lines(
  { type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" },
  { type: "turn.started" },
  {
    type: "item.started",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "bash -lc ls",
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: { id: "item_0", type: "command_execution", command: "bash -lc ls", exit_code: 0 },
  },
  { type: "item.completed", item: { id: "item_1", type: "reasoning", text: "**Listing files**" } },
  { type: "item.completed", item: { id: "item_2", type: "agent_message", text: "Three files." } },
  {
    type: "turn.completed",
    usage: { input_tokens: 2400, cached_input_tokens: 0, output_tokens: 12 },
  },
);

export const CODEX_OLD = lines(
  { model: "gpt-5", sandbox: "read-only" },
  { prompt: "What is here?" },
  { id: "0", msg: { type: "session_configured", session_id: "c-old-1", model: "gpt-5" } },
  { id: "0", msg: { type: "exec_command_begin", command: ["bash", "-lc", "ls"] } },
  { id: "0", msg: { type: "agent_message", message: "Old codex says hi." } },
  { id: "0", msg: { type: "task_complete", last_agent_message: "Old codex says hi." } },
);

export const GEMINI_STREAM = lines(
  { type: "init", timestamp: "t", session_id: "g-1", model: "gemini-2.5-pro" },
  { type: "message", timestamp: "t", role: "user", content: "hello" },
  { type: "message", timestamp: "t", role: "assistant", content: "Hel", delta: true },
  { type: "message", timestamp: "t", role: "assistant", content: "lo there.", delta: true },
  { type: "tool_use", tool_name: "read_file", tool_id: "x", parameters: { absolute_path: "/x" } },
  {
    type: "result",
    timestamp: "t",
    status: "success",
    stats: { total_tokens: 90, input_tokens: 80, output_tokens: 10 },
  },
);

export const GEMINI_JSON = `${JSON.stringify(
  { response: "From the json format.", stats: { models: {} } },
  null,
  2,
).replace(/\n\s*/g, " ")}\n`;

export const GROK_LINES = lines(
  {
    role: "assistant",
    content: "",
    tool_calls: [{ function: { name: "view_file", arguments: '{"path":"README.md"}' } }],
  },
  { role: "tool", tool_call_id: "c1", content: "# Readme" },
  { role: "assistant", content: "The readme is one heading." },
);

export const CURSOR_STREAM = lines(
  { type: "system", subtype: "init", session_id: "cur-1", model: "gpt-5" },
  {
    type: "tool_call",
    subtype: "started",
    tool_call: { readToolCall: { args: { path: "src/main.ts" } } },
  },
  {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Cursor read it." }] },
  },
  { type: "result", subtype: "success", result: "Cursor read it.", session_id: "cur-1" },
);

export const PLAIN = "\u001b[1mPlain\u001b[0m answer\nsecond line\n";
