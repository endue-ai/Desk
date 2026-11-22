/**
 * A window's database sessions end with the window (ADR 0339): the core keeps a session for the
 * plugin until told, and only the runtime knows which window opened it. When a window closes, each
 * session it opened is closed as its plugin (`db.close`, which cancels a running statement first);
 * one whose `db.open` answers after its window closed is closed at once. A window whose frame
 * sleeps (ADR 0134) or reloads keeps them: its next page takes them back (ADR 0320).
 */
import type { BridgeClient, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";
import { pluginOf } from "./instances";
import { claimKey, type Owners } from "./owners";

const PREFIX = "db:";

function close(bridge: BridgeClient, key: string, sessionKey: string): void {
  const sessionId = sessionKey.slice(PREFIX.length);
  void bridge.call("db.close", { sessionId }, { caller: pluginOf(key) }).catch(() => {});
}

/** Window `key` is gone: close the sessions it opened, and route nothing more for them. */
export function closeSessions(owners: Owners, key: string, bridge: BridgeClient): void {
  for (const sessionKey of owners.held(key, PREFIX)) {
    owners.release(sessionKey);
    close(bridge, key, sessionKey);
  }
}

/** A call of window `key` answered after the window closed: a session it opened closes now. */
export function closeLate(
  request: BridgeRequest,
  response: BridgeResponse,
  key: string,
  owners: Owners,
  bridge: BridgeClient,
): void {
  const sessionKey = claimKey(request, response);
  if (request.method !== "db.open" || sessionKey === undefined) return;
  owners.release(sessionKey);
  close(bridge, key, sessionKey);
}
