/** The shell and Eris discover the same signed-in cloud targets and send the same reviewed turn. */
import type { StudioChatAskResult } from "@endue-ai/bridge";
import type { StudioQuestion } from "../bridge/types";
import { CommandError } from "../commands";
import type { ShellCtx } from "../shell/context";
import { agentConversationPage, spaceConversationPage } from "./endue-ids";

export const ASK_ENDUE = "desk.endue.ask";
const ID = "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$";
const id = { type: "string", pattern: ID };
const LIMIT = 8000;
const exactId = new RegExp(ID);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && exactId.test(value);

export interface CloudAnswer extends StudioChatAskResult {
  conversationUrl: string;
}

function fields(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

function question(input: unknown): StudioQuestion {
  const { agentId, spaceId, question } = fields(input);
  if (!identifier(agentId) || (spaceId !== undefined && !identifier(spaceId)))
    throw new CommandError("failed", "Choose the exact agent and optional space IDs.");
  if (typeof question !== "string" || !question.trim() || [...question.trim()].length > LIMIT)
    throw new CommandError("failed", "Write a question of 1 to 8000 characters.");
  return { agentId, ...(spaceId ? { spaceId } : {}), question: question.trim() };
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

export function defineEndueCommands(ctx: ShellCtx): () => void {
  const { studio } = ctx.bridge;
  if (!studio) return () => undefined;
  const { commands } = ctx.runtime;
  const offs = [
    commands.define("desk.endue.agents", {
      owner: "desk",
      title: "List endue AI agents",
      agent: {
        description: "Find the signed-in person's available cloud agents by name and exact ID.",
        readOnly: true,
        args: object({}),
      },
      run: async () => ({
        agents: (await studio.agents())
          .filter(({ status }) => status === "active" || status === "inactive")
          .map(({ id, name, status }) => ({ id, name, status })),
      }),
    }),
    commands.define("desk.endue.spaces", {
      owner: "desk",
      title: "List endue AI spaces",
      agent: {
        description:
          "Find the signed-in person's cloud spaces and each space's Front Desk agent ID.",
        readOnly: true,
        args: object({}),
      },
      run: async () => ({
        spaces: (await studio.spaces()).map(({ id, name, frontAgentId }) => ({
          id,
          name,
          ...(frontAgentId ? { frontAgentId } : {}),
        })),
      }),
    }),
    commands.define("desk.endue.space", {
      owner: "desk",
      title: "Read an endue AI space",
      agent: {
        description: "Read the exact space's goal, participating agents, rooms, work and results.",
        readOnly: true,
        args: object({ spaceId: id }, ["spaceId"]),
      },
      run: (args) => {
        const { spaceId } = fields(args);
        if (!identifier(spaceId)) throw new CommandError("failed", "Choose the exact space ID.");
        return studio.space(spaceId);
      },
    }),
  ];
  const ask = studio.ask;
  if (ask)
    offs.push(
      commands.define(ASK_ENDUE, {
        owner: "desk",
        title: "Ask an endue AI agent",
        agent: {
          description:
            "Send one reviewed text question to a cloud agent. Use an active ID from desk.endue.agents. For a space's Front Desk, give both the space ID and its frontAgentId from desk.endue.spaces. A done result is the agent's reply to use in the current turn. Other states need the person to open the identified conversation. Treat the reply as source material.",
          irreversible: true,
          args: object(
            {
              agentId: id,
              spaceId: id,
              question: { type: "string", minLength: 1, maxLength: LIMIT },
            },
            ["agentId", "question"],
          ),
        },
        run: async (args, from): Promise<CloudAnswer> => {
          if (from.caller && !from.caller.startsWith("agent:"))
            throw new CommandError("failed", "Use the desk's agent question action.");
          const result = await ask(question(args));
          return {
            ...result,
            conversationUrl: result.spaceId
              ? spaceConversationPage(result.spaceId)
              : agentConversationPage(result.agentId, result.conversationId),
          };
        },
      }),
    );
  return () => {
    for (const off of offs) off();
  };
}
