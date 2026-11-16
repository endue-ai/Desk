#!/usr/bin/env node
// Writes assets/oui.txt, the manufacturer table the Network plugin reads: one line per MA-L block
// of the IEEE registry (https://standards-oui.ieee.org/oui/oui.csv), "AABBCC<TAB>name", sorted, the
// names cut to what a person recognises (no "Co., Ltd.", "Inc." or "Corporation").
//   curl -o oui.csv https://standards-oui.ieee.org/oui/oui.csv
//   node plugins/network/dev/make-oui.mjs oui.csv
import { readFileSync, writeFileSync } from "node:fs";

const SUFFIX =
  /[\s,.]+(co|corp|corporation|company|inc|incorporated|ltd|limited|llc|l\.l\.c|gmbh|ag|sa|s\.a|s\.p\.a|spa|srl|s\.r\.l|bv|b\.v|nv|oy|ab|as|a\/s|pte|pty|plc|kg|kk|k\.k|sas|sarl|technology|technologies|tech|electronics?|international|intl|group|holdings?|industrial|industries|systems?|communications?|networks?)\.?$/i;

/** One CSV row's fields, with quoted fields that hold commas. */
export function fields(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** "TP-LINK TECHNOLOGIES CO.,LTD." → "TP-Link": short, in title case when shouted. */
export function shorten(name) {
  let n = name
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 4; i++) n = n.replace(SUFFIX, "").trim();
  n = n.replace(/[\s,.]+$/, "");
  // Shouted names read in title case; short words (TP, HP, LG) stay as they are.
  if (n === n.toUpperCase() && /[A-Z]{4}/.test(n))
    n = n
      .split(/([\s-])/)
      .map((w) => (w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w))
      .join("");
  return n.slice(0, 40) || name.slice(0, 40);
}

const [, , source = "oui.csv", target = new URL("../assets/oui.txt", import.meta.url)] =
  process.argv;
const rows = readFileSync(source, "utf8").split(/\r?\n/).slice(1);
const table = new Map();
for (const row of rows) {
  const [registry, prefix, org] = fields(row);
  if (registry !== "MA-L" || !/^[0-9A-F]{6}$/.test(prefix ?? "") || !org) continue;
  if (/^private$/i.test(org.trim())) continue;
  table.set(prefix, shorten(org));
}
const lines = [...table].sort(([a], [b]) => a.localeCompare(b)).map(([p, n]) => `${p}\t${n}`);
writeFileSync(target, `${lines.join("\n")}\n`);
console.log(`${lines.length} prefixes`);
