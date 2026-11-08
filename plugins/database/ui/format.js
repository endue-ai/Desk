/** Format a count in the person's locale. */
export function formatCount(/** @type {number} */ count) {
  return count.toLocaleString();
}

/** Format milliseconds as milliseconds, seconds, or minutes and seconds. */
export function formatDuration(/** @type {number} */ ms) {
  if (ms <= 1000) return `${formatCount(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${formatCount(Math.floor(seconds / 60))} min ${seconds % 60} s`;
}
