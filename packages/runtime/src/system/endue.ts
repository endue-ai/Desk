/**
 * The person's endue AI agents and spaces in the shell (ADR 0129). Signed in, the agent bar lists
 * them from studio.* instead of the agent directory (specs/brain/v0, which endue AI does not
 * serve); choosing one opens its window, a card that turns over to show Studio. Signed out, or on a
 * host without studio.*, the state is off and the agent bar keeps the directory. Signing in or out
 * reads again.
 */
import type { Ctx } from "../shell/actions";
import { openView } from "../shell/windows";
import {
  ENDUE_AGENT_VIEW,
  ENDUE_SPACE_VIEW,
  type EndueState,
  emptyEndue,
  type Read,
  WEB,
} from "./endue-ids";

export * from "./endue-ids";

/** Reads started per desk, so an older answer never overwrites a newer one. */
const generations = new WeakMap<object, number>();

const set = (ctx: Ctx, change: (e: EndueState) => Partial<EndueState>) =>
  ctx.store.set((s) => ({ endue: { ...s.endue, ...change(s.endue) } }));

/** Why a read failed, and whether it was for being signed out. */
function failed(error: unknown): Extract<Read<never>, { state: "failed" }> {
  const code = (error as { code?: unknown } | null)?.code;
  const why = error instanceof Error ? error.message : String(error);
  return { state: "failed", why, signedOut: code === "signed_out" };
}

/** Read the agents, the spaces and the conversations again; off unless the desk is signed in. */
export async function loadEndue(ctx: Ctx): Promise<void> {
  const { studio, account } = ctx.bridge;
  const current = (generations.get(ctx.store) ?? 0) + 1;
  generations.set(ctx.store, current);
  const latest = () => generations.get(ctx.store) === current;
  const signedIn =
    studio && account
      ? await account.status().then(
          (status) => status.state === "signed-in",
          () => false,
        )
      : false;
  if (!latest()) return;
  if (!studio || !signedIn) {
    ctx.store.set({ endue: emptyEndue() });
    return;
  }
  set(ctx, (e) => ({ state: e.state === "ready" ? "ready" : "loading" }));
  try {
    const [agents, spaces, conversations] = await Promise.all([
      studio.agents(),
      studio.spaces(),
      // Presence only: the agents and spaces show without it.
      studio.conversations().catch(() => []),
    ]);
    if (latest()) set(ctx, () => ({ state: "ready", agents, spaces, conversations }));
  } catch {
    if (latest()) set(ctx, () => ({ state: "offline" }));
  }
}

/** Read again whenever the desk signs in or out. Returns the unsubscribe. */
export function watchEndue(ctx: Ctx): () => void {
  const { account, studio } = ctx.bridge;
  if (!account || !studio) return () => undefined;
  let last: string | undefined;
  return account.onChange((status) => {
    if (status.state === "signing-in" || status.state === last) return;
    last = status.state;
    void loadEndue(ctx);
  });
}

/** Read one agent's facets, unless a read is under way or done; `again` reads anyway. */
export async function readFacets(ctx: Ctx, id: string, again = false): Promise<void> {
  const studio = ctx.bridge.studio;
  const known = ctx.store.get().endue.facets[id];
  if (!studio || (!again && known && known.state !== "failed")) return;
  set(ctx, (e) => ({ facets: { ...e.facets, [id]: { state: "loading" } } }));
  const read: Read<Awaited<ReturnType<typeof studio.facets>>> = await studio
    .facets(id)
    .then((value) => ({ state: "ready", value }), failed);
  set(ctx, (e) => ({ facets: { ...e.facets, [id]: read } }));
}

/** Read what one space is doing, unless a read is under way or done; `again` reads anyway. */
export async function readSpace(ctx: Ctx, id: string, again = false): Promise<void> {
  const studio = ctx.bridge.studio;
  const known = ctx.store.get().endue.details[id];
  if (!studio || (!again && known && known.state !== "failed")) return;
  set(ctx, (e) => ({ details: { ...e.details, [id]: { state: "loading" } } }));
  const read: Read<Awaited<ReturnType<typeof studio.space>>> = await studio
    .space(id)
    .then((value) => ({ state: "ready", value }), failed);
  set(ctx, (e) => ({ details: { ...e.details, [id]: read } }));
}

/** Choose an agent: its window comes to the middle of the desk, its card to the front. */
export function openEndueAgent(ctx: Ctx, id: string): void {
  ctx.store.set((s) => ({ popover: null, endue: { ...s.endue, agent: id } }));
  openView(ctx, `${ENDUE_AGENT_VIEW}${id}`);
  void readFacets(ctx, id);
}

/** Choose a space: its window comes to the middle of the desk. */
export function openEndueSpace(ctx: Ctx, id: string): void {
  ctx.store.set((s) => ({ popover: null, endue: { ...s.endue, space: id } }));
  openView(ctx, `${ENDUE_SPACE_VIEW}${id}`);
  void readSpace(ctx, id);
}

/** Turn a window's card over: to Studio, or back to the card. */
export function flipCard(ctx: Ctx, view: string, toBack?: boolean): void {
  set(ctx, (e) => {
    const back = toBack ?? !e.flipped.includes(view);
    const rest = e.flipped.filter((v) => v !== view);
    return { flipped: back ? [...rest, view] : rest };
  });
}

/** Open one of endue.ai's pages in the system browser; nothing else is ever opened. */
export function openOnWeb(ctx: Ctx, url: string): Promise<void> {
  if (!url.startsWith(`${WEB}/`)) return Promise.reject(new Error(`not an endue.ai page: ${url}`));
  return ctx.bridge.studio?.open(url) ?? Promise.resolve();
}
