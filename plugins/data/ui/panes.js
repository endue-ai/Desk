// The existing small-file panes and the worker view share the surface and the same view hooks.
import { createRawView } from "./raw-view.js";
import { createRemoteRaw } from "./remote-raw.js";
import { createRemoteTree } from "./remote-tree.js";
import { createTreeView } from "./tree-view.js";

export function createPanes(doc, elements, hooks) {
  const localTree = createTreeView(doc, elements.tree, hooks);
  const remoteTree = createRemoteTree(doc, elements.tree, hooks);
  const localRaw = createRawView(doc, elements.raw);
  const remoteRaw = createRemoteRaw(doc, elements.raw, hooks.status);
  let tree = localTree;
  let raw = localRaw;
  return {
    tree: {
      load(data, state, keys, remote) {
        if (remote) {
          localTree.load(null, { expanded: new Set(), selected: null }, keys);
          tree = remoteTree;
          remoteTree.load(remote, keys);
        } else {
          remoteTree.load(null, keys);
          tree = localTree;
          localTree.load(data, state, keys);
        }
      },
      mask: (keys, revealed) => tree.mask(keys, revealed),
      expandAll: () => tree.expandAll(),
      collapseAll: () => tree.collapseAll(),
      reveal: (path) => tree.reveal(path),
      selected: () => tree.selected(),
      focus: () => tree.focus(),
    },
    raw: {
      load(opened, hidden, errors) {
        if (opened?.remote) {
          localRaw.load(null, [], []);
          raw = remoteRaw;
          remoteRaw.load(opened);
        } else {
          remoteRaw.load(null);
          raw = localRaw;
          localRaw.load(opened, hidden, errors);
        }
      },
      mask: (hidden) => raw.mask(hidden),
      goTo: (line, col) => raw.goTo(line, col),
      focus: () => raw.focus(),
    },
  };
}
