// The features that hang off the studio's hooks (studio.extra): the merge conflict tool, a file's
// history and blame, and the AI. Kept apart so studio.js stays the window's frame.

import { WIP } from "./app.js";
import { shortSha } from "./format.js";
import { createConflictView } from "./view-conflict.js";

/** @param {ReturnType<typeof import("./studio.js").createStudio>} studio */
export function installFeatures(studio) {
  const { app, center, extra } = studio;
  const snap = () => app.get().snapshot;

  /** What to call each side: in a rebase "ours" is the branch being rebased onto. */
  function labels() {
    const s = snap();
    const branch = s?.status.branch ?? "HEAD";
    const head = s?.operationHead ?? null;
    const named = head ? s?.refs.find((r) => r.sha === head && r.kind !== "tag")?.name : undefined;
    const incoming = named ?? (head ? shortSha(head) : "incoming");
    if (s?.operation === "rebase")
      return {
        ours: `${branch === "HEAD" ? "the branch rebased onto" : branch}`,
        theirs: `your commit ${incoming}`,
      };
    return { ours: branch, theirs: incoming };
  }

  const conflict = createConflictView(app, center.page("conflict"), {
    onBack: () => center.back(),
    labels,
    onSaved: async (path) => {
      await app.refresh();
      const next = snap()?.status.conflicts.find((c) => c.path !== path);
      if (next) return conflict.open(next.path);
      center.back();
      void app.select(WIP);
    },
  });
  extra.resolve = (path) => {
    center.show("conflict");
    void conflict.open(path);
  };

  return { conflict };
}
