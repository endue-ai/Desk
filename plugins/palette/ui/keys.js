// A command's key hints. desk.keys.list names a key sequence chord by chord with one space between
// ("⌘K ⌘S", ADR 0118), so each binding is its chords, and the row shows one <kbd> per chord.

/** Each key's chords: ["⌘K ⌘S", "⇧⌘P"] → [["⌘K", "⌘S"], ["⇧⌘P"]]. */
export function chordsOf(keys) {
  return keys.map((key) => String(key).split(" ").filter(Boolean)).filter((c) => c.length > 0);
}

/** The hint as nodes: chords of a key in <kbd>s a space apart, keys a comma apart. */
export function keyHint(keys, make) {
  const nodes = [];
  for (const [i, chords] of chordsOf(keys).entries()) {
    if (i > 0) nodes.push(", ");
    for (const [j, chord] of chords.entries()) {
      if (j > 0) nodes.push(" ");
      nodes.push(make("kbd", {}, chord));
    }
  }
  return nodes;
}
