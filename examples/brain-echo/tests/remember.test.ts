import { describe, expect, it } from "vitest";
import { EchoBrain } from "../brain.mjs";

/** A session with a lease, as the desk opens one. */
function opened() {
  const brain = new EchoBrain({ now: () => 0 });
  const session = brain.createSession({ client: { name: "test", version: "1" } });
  const lease = brain.acquireLease(session.id, { holder: { deskId: "d1" }, ttlSeconds: 60 });
  return { brain, session: session.id, lease: lease.leaseId };
}

const remember = {
  name: "desk-remember",
  description: "Keep a fact.",
  schema: { type: "object", properties: { text: { type: "string" } } },
};
const line = (text: string) => ({ role: "user", content: [{ type: "text", text }] });

describe("brain-echo and Eris's memory (Desk ADR 0096)", () => {
  it("calls desk-remember for a line that starts with 'remember that'", () => {
    const { brain, session, lease } = opened();
    const events = brain.startTurn(session, {
      leaseId: lease,
      message: line("remember that I prefer pnpm"),
      tools: [remember],
    });
    const call = events.find((e: { type: string }) => e.type === "tool.call");
    expect(call?.call).toMatchObject({
      name: "desk-remember",
      arguments: { text: "I prefer pnpm" },
    });
  });

  it("answers in words when desk-remember is not offered", () => {
    const { brain, session, lease } = opened();
    const events = brain.startTurn(session, { leaseId: lease, message: line("remember that tea") });
    expect(events.some((e: { type: string }) => e.type === "tool.call")).toBe(false);
  });

  it("takes the turn's context and refuses one in another shape", () => {
    const { brain, session, lease } = opened();
    const context = {
      facts: [{ id: "fact_1", text: "Prefers pnpm" }],
      working: { now: "2026-11-05T00:00:00.000Z" },
    };
    expect(() =>
      brain.startTurn(session, { leaseId: lease, message: line("hi"), context }),
    ).not.toThrow();
    expect(() =>
      brain.startTurn(session, { leaseId: lease, message: line("hi"), context: { mood: 1 } }),
    ).toThrow(/not a TurnRequest/);
  });
});
