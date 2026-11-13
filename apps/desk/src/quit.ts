// Quitting asks this page first (#163, `apps/desk/shell/src/quit.rs`): the shell says
// `desk://quit` and waits for the answer (`desk_quit`). With nothing unsaved the answer is `quit`
// at once. Otherwise the page says it is `asking`, so the shell waits for the person however long
// they take, asks about each buffer with unsaved changes as closing it does (desk.buffers), and
// answers `quit` or `stay`. A save the person chose that fails keeps the desk, and says why.
//
// A quit `{ why: "stalled" }` is the shell's own: this page stopped painting and the desk would
// start again (ADR 0202). Nobody would see a question this page draws, so it asks nothing: `quit`
// with nothing unsaved, else `stay`, which keeps the desk as it is.
import type { Desk } from "@endue-ai/runtime";

export type QuitAnswer = "asking" | "quit" | "stay";

export interface QuitHost {
  buffers: Pick<Desk["runtime"]["buffers"], "mayGo" | "list">;
  listen(event: string, handler: (event: { payload?: unknown }) => void): Promise<() => void>;
  answer(answer: QuitAnswer): Promise<unknown>;
  report(error: unknown): void;
}

export const QUIT_EVENT = "desk://quit";

/** Whether the shell quits because this page stopped painting. */
export function forStall(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { why?: unknown }).why === "stalled"
  );
}

export function installQuit(host: QuitHost): () => void {
  let active = true;
  let deciding = false;
  let told = false;
  const answer = (value: QuitAnswer) => host.answer(value).catch(() => undefined);
  const stalled = async () => {
    // A question already up, or anything unsaved: the desk stays, as nobody could answer here.
    let unsaved = deciding;
    try {
      unsaved ||= host.buffers.list().some((buffer) => buffer.modified);
    } catch (error) {
      host.report(error);
      unsaved = true;
    }
    await answer(unsaved ? "stay" : "quit");
  };
  const decide = async () => {
    // Quit again while the person decides: the same quit, and the shell hears it is still asked.
    if (deciding) {
      if (told) void answer("asking");
      return;
    }
    deciding = true;
    told = false;
    const asking = () => {
      if (told) return;
      told = true;
      void answer("asking");
    };
    try {
      const go = await host.buffers.mayGo("quit", { asking });
      await answer(go ? "quit" : "stay");
    } catch (error) {
      host.report(error);
      await answer("stay");
    } finally {
      deciding = false;
    }
  };
  const heard = (event: { payload?: unknown } | undefined) => {
    if (!active) return;
    void (forStall(event?.payload) ? stalled() : decide());
  };
  const off = host.listen(QUIT_EVENT, heard).catch((error) => {
    host.report(error);
    return () => {};
  });
  return () => {
    active = false;
    void off.then((stop) => stop());
  };
}
