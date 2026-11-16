// The shapes a chat goes through, whichever server answers it (types only).

/**
 * @typedef {{ name: string, type: string, data: string }} Image  base64, no data: prefix
 * @typedef {{ id: string, name: string, args: Record<string, unknown> }} ToolCall
 * @typedef {{
 *   role: "system" | "user" | "assistant" | "tool",
 *   content: string,
 *   images?: Image[],
 *   toolCalls?: ToolCall[],
 *   toolCallId?: string,
 * }} ChatMessage
 * @typedef {{
 *   temperature?: number,
 *   topP?: number,
 *   topK?: number,
 *   minP?: number,
 *   repeatPenalty?: number,
 *   presencePenalty?: number,
 *   frequencyPenalty?: number,
 *   maxTokens?: number,
 *   contextLength?: number,
 *   seed?: number,
 *   stop?: string[],
 * }} Sampling
 * @typedef {{
 *   model: string,
 *   messages: ChatMessage[],
 *   params?: Sampling,
 *   think?: boolean,
 *   format?: "json" | Record<string, unknown>,
 *   tools?: unknown[],
 *   keepAlive?: string,
 *   signal?: AbortSignal,
 * }} ChatRequest
 * @typedef {{ content?: string, reasoning?: string, toolCall?: ToolCall }} Delta
 * @typedef {{
 *   promptTokens?: number,
 *   tokens?: number,
 *   ttftMs?: number,
 *   totalMs?: number,
 *   tokPerSec?: number,
 *   loadMs?: number,
 *   stopReason?: string,
 * }} Stats
 * @typedef {{ content: string, reasoning: string, toolCalls: ToolCall[], stats: Stats }} ChatResult
 */

export {};
