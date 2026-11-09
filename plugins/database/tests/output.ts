// The result reader for tests that run the plugin without a browser: the worker's own `answer`,
// called a turn later as the worker's reply would come, over what the worker would receive.
import type { Invocation, Outcome } from "../ui/engines/common.js";
import { answer } from "../ui/output-worker.js";
import { outputBytes } from "../ui/run.js";

export function inProcessOutput() {
  return {
    read: async (engine: string, outcome: Outcome, invocation: Invocation, timeoutMs: number) => {
      await Promise.resolve();
      const bytes = outputBytes(outcome);
      const { statements, nonce, maxRows } = invocation;
      const reply = answer({
        id: 1,
        engine: engine as never,
        outcome: {
          ...outcome,
          stdout: bytes?.stdout ?? outcome.stdout,
          stderr: bytes?.stderr ?? outcome.stderr,
        },
        invocation: { statements, nonce, maxRows },
        timeoutMs,
      });
      if ("error" in reply) throw new Error(reply.error);
      return reply.result;
    },
    cancel() {},
  };
}
