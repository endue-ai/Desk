// The SQL console's language for the editor component, all from the plugin's own lexer: the token
// cache (tokens.js) kept in the editor state, the highlighting of the lines on screen as `tok-*`
// classes (work.css), the bracket and quote at the caret marked with their partner, the fold
// service, and the background checking of the checkpoints in slices of at most 4 ms while the
// frame is idle.

import {
  Decoration,
  EditorSelection,
  Facet,
  foldService,
  RangeSetBuilder,
  StateEffect,
  StateField,
  ViewPlugin,
} from "../vendor/editor/editor-component.mjs";
import { runsOf } from "./highlight.js";
import { foldsIn, pairAt } from "./pairs.js";
import { Lexed } from "./tokens.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./pairs.js").Range} Range
 */

/** The most one background slice takes, in ms. */
export const SLICE_MS = 4;
/** How many carets get their bracket marked. */
const MARKED = 16;

/** The dialect the console's connection speaks. */
export const dialectFacet = Facet.define({
  combine: (/** @type {readonly Dialect[]} */ values) => values[0] ?? "postgresql",
});

/** Said when the background checking reached lines drawn before it got there. */
const relexed = StateEffect.define();

/** The token cache of the state's text. */
export const lexedField = StateField.define({
  create: (state) => new Lexed(state.facet(dialectFacet), state.doc),
  update(value, tr) {
    const dialect = tr.state.facet(dialectFacet);
    if (dialect !== value.dialect) return new Lexed(dialect, tr.state.doc);
    return tr.docChanged ? value.map(tr.changes, tr.state.doc) : value;
  },
});

/** @type {WeakMap<Lexed, { from: number, to: number, folds: Map<number, Range> }>} */
const foldCache = new WeakMap();

/** The fold of the line `from`..`to`, from the folds of the lines after it, read once per text. */
const folds = foldService.of((state, from, to) => {
  const lexed = state.field(lexedField);
  let cached = foldCache.get(lexed);
  if (!cached || from < cached.from || from >= cached.to) {
    const end = Math.min(state.doc.length, Math.max(to, from + 16384));
    cached = { from, to: end + 1, folds: foldsIn(lexed, from, end + 1) };
    foldCache.set(lexed, cached);
  }
  return cached.folds.get(from) ?? null;
});

const marks = new Map();
const mark = (/** @type {string} */ kind) => {
  let found = marks.get(kind);
  if (!found) {
    found = Decoration.mark({ class: `tok-${kind}` });
    marks.set(kind, found);
  }
  return found;
};

/** Run `work` when the frame is idle, at most once at a time. */
function idle(/** @type {Window | null} */ win, /** @type {() => void} */ work) {
  if (win?.requestIdleCallback) win.requestIdleCallback(work, { timeout: 200 });
  else setTimeout(work, 16);
}

const highlighter = ViewPlugin.fromClass(
  class {
    /** @param {import("../vendor/editor/editor-component.mjs").EditorView} view */
    constructor(view) {
      this.view = view;
      this.scheduled = false;
      this.waiting = false;
      this.decorations = this.build(view);
    }

    /** @param {import("../vendor/editor/editor-component.mjs").ViewUpdate} update */
    update(update) {
      const again = update.transactions.some((tr) => tr.effects.some((e) => e.is(relexed)));
      const dialect = update.startState.facet(dialectFacet) !== update.state.facet(dialectFacet);
      if (update.docChanged || update.viewportChanged || again || dialect)
        this.decorations = this.build(update.view);
    }

    build(/** @type {import("../vendor/editor/editor-component.mjs").EditorView} */ view) {
      const lexed = view.state.field(lexedField);
      const builder = new RangeSetBuilder();
      this.waiting = false;
      for (const { from, to } of view.visibleRanges) {
        const { tokens, exact } = lexed.tokens(from, to);
        if (!exact) this.waiting = true;
        for (const span of runsOf(tokens, lexed.dialect, from, to))
          builder.add(span.from, span.to, mark(span.kind));
      }
      if (!lexed.done) this.schedule();
      return builder.finish();
    }

    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      const win = this.view.dom.ownerDocument.defaultView;
      const step = () => {
        this.scheduled = false;
        const lexed = this.view.state.field(lexedField, false);
        if (!lexed) return;
        const deadline = performance.now() + SLICE_MS;
        const done = lexed.work(() => performance.now() > deadline);
        if (this.waiting && (done || this.view.visibleRanges.every((r) => lexed.checked >= r.from)))
          this.view.dispatch({ effects: relexed.of(null) });
        else if (!done) this.schedule();
      };
      idle(win, step);
    }

    destroy() {
      this.scheduled = true;
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const matching = Decoration.mark({ class: "cm-matchingBracket" });
const unmatched = Decoration.mark({ class: "cm-nonmatchingBracket" });

/** The bracket or quote at each caret, with its partner. */
const matcher = ViewPlugin.fromClass(
  class {
    /** @param {import("../vendor/editor/editor-component.mjs").EditorView} view */
    constructor(view) {
      this.decorations = this.build(view.state);
    }

    /** @param {import("../vendor/editor/editor-component.mjs").ViewUpdate} update */
    update(update) {
      if (update.docChanged || update.selectionSet || update.focusChanged)
        this.decorations = this.build(update.state);
    }

    build(/** @type {import("../vendor/editor/editor-component.mjs").EditorState} */ state) {
      const lexed = state.field(lexedField);
      /** @type {{ from: number, to: number, value: unknown }[]} */
      const found = [];
      for (const range of state.selection.ranges.slice(0, MARKED)) {
        if (!range.empty) continue;
        const pair = pairAt(lexed, range.head);
        if (!pair) continue;
        const kind = pair.end ? matching : unmatched;
        found.push({ ...pair.start, value: kind });
        if (pair.end) found.push({ ...pair.end, value: kind });
      }
      found.sort((a, b) => a.from - b.from || a.to - b.to);
      const builder = new RangeSetBuilder();
      let last = -1;
      for (const { from, to, value } of found) {
        if (from < last) continue;
        builder.add(from, to, /** @type {never} */ (value));
        last = to;
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Move each caret to the partner of the bracket or quote it touches. */
export function toMatching(
  /** @type {import("../vendor/editor/editor-component.mjs").EditorView} */ view,
) {
  const lexed = view.state.field(lexedField);
  let moved = false;
  const selection = EditorSelection.create(
    view.state.selection.ranges.map((range) => {
      const pair = pairAt(lexed, range.head);
      if (!pair?.end) return range;
      moved = true;
      const into = range.head <= pair.start.to ? pair.end.to : pair.start.from;
      return EditorSelection.cursor(into);
    }),
    view.state.selection.mainIndex,
  );
  if (moved) view.dispatch({ selection, scrollIntoView: true, userEvent: "select" });
  return moved;
}

/** The language: the token cache, highlighting, bracket marks and folds (the dialect apart). */
export const sqlLanguage = [lexedField, highlighter, matcher, folds];
