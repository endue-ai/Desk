// A note's word and character counts. Segmenting a long note takes hundreds of milliseconds, so
// only the counting worker (count-worker.js) runs this, never the frame's main thread (#38).

/** @typedef {{ words: number, characters: number }} Counts */

/** @param {string} text @returns {Counts} */
export function countText(text) {
  let words = 0;
  let characters = 0;
  for (const segment of new Intl.Segmenter(undefined, { granularity: "word" }).segment(text))
    if (segment.isWordLike) words++;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text))
    characters++;
  return { words, characters };
}
