// A scripted brain for the SQL assist's tests (PG-90): brain.ask answered as the core answers it, a
// turnId at once and the turn's `completed` with the tool's arguments a moment later, every ask kept
// so a test reads exactly what was sent. No network.
import { StubError } from "../../../packages/bridge/src/index";
import type { Handlers } from "./harness";

export interface Asked {
  prompt: string;
  tool: { name: string; description: string; schema: Record<string, unknown> };
  scope: { permission: string };
}

type Emit = (event: { event: string; data: unknown }) => void;

/** `answer` gives the tool's arguments for an ask, or undefined to answer in words. */
export function scriptedBrain(answer: (asked: Asked) => Record<string, unknown> | undefined) {
  const asked: Asked[] = [];
  let emit: Emit = () => {};
  let off = false;
  const handlers: Handlers = {
    "brain.ask": (params) => {
      if (off) throw new StubError("unsupported", "No brain is set up on this desk.");
      const ask = params as unknown as Asked;
      asked.push(ask);
      const turnId = `ask-${asked.length}`;
      setTimeout(() => {
        emit({ event: "brain.turn", data: { turnId, kind: "started" } });
        const structured = answer(ask);
        emit({
          event: "brain.turn",
          data: structured
            ? { turnId, kind: "completed", structured }
            : { turnId, kind: "completed", text: "In words only." },
        });
      }, 0);
      return { turnId };
    },
  };
  return {
    handlers,
    asked,
    /** The host whose events the turns are. */
    attach(host: { emit: Emit }) {
      emit = (event) => host.emit(event);
    },
    /** No brain on this desk from now on: brain.ask answers `unsupported`. */
    unplug() {
      off = true;
    },
  };
}
