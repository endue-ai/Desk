/** The browser development core's published search documents; the native OS index stays unavailable. */
import type { PluginInfo, SearchDocument, SearchHit, StubHandlers } from "@endue-ai/bridge";
import { StubError } from "@endue-ai/bridge";
import type { CoreStore } from "./core";

export function searchHandlers(plugins: PluginInfo[], store: CoreStore): StubHandlers {
  return {
    "search.replace": ({ documents }, caller) => {
      if (!plugins.some((p) => p.id === caller && p.enabled && p.status === "ready"))
        throw new StubError("permission_denied", "Only installed plugins publish documents");
      store.set(`search:${caller}`, documents);
      return {};
    },
    "search.query": ({ query, limit }) => {
      const words = query.toLocaleLowerCase().trim().split(/\s+/);
      const matches = (text: string) => words.every((w) => text.toLocaleLowerCase().includes(w));
      const hits: SearchHit[] = [];
      for (const p of plugins) {
        if (p.status !== "ready" || p.manifest?.kind !== "ui" || p.id === "desk.palette") continue;
        const title = p.manifest.name ?? p.id;
        const detail = p.manifest.description ?? p.id;
        if (matches(`${title} ${detail} ${p.id}`))
          hits.push({ id: `plugin:${p.id}`, title, detail, kind: "plugin", plugin: p.id });
        if (!p.enabled) continue;
        for (const d of (store.get(`search:${p.id}`) ?? []) as SearchDocument[]) {
          if (matches(`${d.title} ${d.detail ?? ""} ${d.text ?? ""}`)) {
            const { text: _text, ...doc } = d;
            hits.push({ ...doc, id: `document:${p.id}:${d.id}`, kind: "document", plugin: p.id });
          }
        }
      }
      return { hits: hits.slice(0, limit ?? 40) };
    },
  };
}
