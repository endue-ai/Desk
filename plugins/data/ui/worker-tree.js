// Tree layout stays beside the parsed document in the worker. Only requested rows cross the port.
import { chainOf } from "./search.js";
import { childrenOf, countOf, isBranch } from "./tree.js";
import { groupKeys } from "./tree-view.js";

const GROUP = 100;
const LIMIT = 20_000;
const bucketOf = (n) => {
  let bucket = GROUP;
  while (bucket * GROUP < n) bucket *= GROUP;
  return bucket;
};

export function workerTree(data, snapshot) {
  const expanded = new Set(
    (data?.roots.length ?? 0) <= 20 ? data?.roots.map((_, i) => String(i)) : [],
  );
  let selected = "0";
  let rows = [];
  let index = new Map();
  let opening = false;
  const open = (key) => {
    if (opening && rows.length < LIMIT) expanded.add(key);
    return expanded.has(key);
  };
  const addChildren = (chain, nodeKey, at, level, from, to) => {
    const node = chain.at(-1);
    const n = to - from;
    if (n > GROUP) {
      const bucket = bucketOf(n);
      for (let start = from, pos = 1; start < to; start += bucket, pos++) {
        const end = Math.min(start + bucket, to);
        const key = `${at}/[${start}-${end}]`;
        rows.push({
          key,
          label: `[${start} … ${end - 1}]`,
          level,
          chain,
          group: { from: start, to: end },
          setsize: Math.ceil(n / bucket),
          posinset: pos,
        });
        if (open(key)) addChildren(chain, nodeKey, key, level + 1, start, end);
      }
    } else {
      const children = childrenOf(node);
      for (let i = from; i < to; i++) {
        const child = children[i];
        if (child)
          addNode(
            [...chain, child],
            `${nodeKey}/${i}`,
            node.kind === "array" ? String(i) : String(child.key ?? i),
            level,
            n,
            i - from + 1,
          );
      }
    }
  };
  const addNode = (chain, key, label, level, setsize, posinset) => {
    rows.push({ key, label, level, chain, setsize, posinset });
    const node = chain.at(-1);
    if (isBranch(node) && open(key)) addChildren(chain, key, key, level + 1, 0, countOf(node));
  };
  const build = () => {
    rows = [];
    const roots = data?.roots ?? [];
    roots.forEach((root, i) => {
      addNode(
        [root],
        String(i),
        roots.length === 1
          ? "root"
          : data.rootLabel === "Line"
            ? `Line ${root.line}`
            : `Document ${i + 1}`,
        1,
        roots.length,
        i + 1,
      );
    });
    index = new Map(rows.map((row, i) => [row.key, i]));
    if (!index.has(selected)) selected = rows[0]?.key;
  };
  const safe = (row) => {
    if (!row) return undefined;
    const node = snapshot(row.chain, row.key);
    const { chain: _chain, ...rest } = row;
    return {
      ...node,
      ...rest,
      label: row.label.slice(0, 300),
      expanded: expanded.has(row.key),
      branch: !!row.group || node.branch,
      preview: row.group ? `${row.group.to - row.group.from} items` : node.preview,
    };
  };
  const summary = () => ({
    count: rows.length,
    index: index.get(selected) ?? 0,
    selected: safe(rows[index.get(selected) ?? 0]),
  });
  const select = (i) => {
    selected = rows[Math.max(0, Math.min(rows.length - 1, i))]?.key;
  };
  const toggle = (row, value = !expanded.has(row?.key)) => {
    if (!row || (!row.group && !isBranch(row.chain.at(-1)))) return;
    if (value) expanded.add(row.key);
    else expanded.delete(row.key);
    build();
  };
  build();
  return {
    rows(from, count) {
      return { count: rows.length, items: rows.slice(from, from + count).map(safe) };
    },
    summary,
    act({ action, key, path, page = 20 }) {
      let i = index.get(selected) ?? 0;
      let row = rows[i];
      if (key !== undefined && index.has(key)) {
        selected = key;
        i = index.get(key);
        row = rows[i];
      }
      if (action === "toggle" || action === "Enter" || action === " ") toggle(row);
      else if (action === "ArrowDown") select(i + 1);
      else if (action === "ArrowUp") select(i - 1);
      else if (action === "Home") select(0);
      else if (action === "End") select(rows.length - 1);
      else if (action === "PageDown") select(i + page);
      else if (action === "PageUp") select(i - page);
      else if (action === "ArrowRight" && row) {
        if (!expanded.has(row.key)) toggle(row, true);
        else if (rows[i + 1]?.level === row.level + 1) select(i + 1);
      } else if (action === "ArrowLeft" && row) {
        if (expanded.has(row.key)) toggle(row, false);
        else
          for (let up = i - 1; up >= 0; up--)
            if (rows[up].level < row.level) {
              select(up);
              break;
            }
      } else if (action === "expand") {
        opening = true;
        build();
        opening = false;
      } else if (action === "collapse") {
        expanded.clear();
        selected = selected?.split("/")[0];
        build();
      } else if (action === "reveal" && path?.length) {
        const chain = chainOf(data, path);
        let at = String(path[0]);
        for (let part = 1; part < chain.length; part++) {
          expanded.add(at);
          for (const group of groupKeys(at, countOf(chain[part - 1]), path[part]))
            expanded.add(group);
          at += `/${path[part]}`;
        }
        selected = at;
        build();
      }
      return summary();
    },
  };
}
