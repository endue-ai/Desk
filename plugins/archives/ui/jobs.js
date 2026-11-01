// Long work on the desk's progress element: opening a file, decoding an entry, extracting. Each job
// has its own AbortController; the newest running job is shown (what it is, how far, Cancel), and
// Cancel aborts it (an extraction also stops between files). The element itself waits 300 ms
// before it appears, so quick work never flashes it.

/**
 * @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress
 * @typedef {{ signal: AbortSignal, report(value: number | null, max?: number, detail?: string): void }} Running
 */

/** @param {(progress: Progress | null) => void} show */
export function createJobs(show) {
  /** @type {Set<{ progress: Progress }>} */
  const running = new Set();
  const render = () => show([...running].at(-1)?.progress ?? null);
  return {
    /**
     * Run `work` as a job shown as `label` with `detail` until it settles.
     * @template T
     * @param {string} label @param {string} detail
     * @param {(job: Running) => Promise<T>} work
     * @param {{ cancel?(): void, signal?: AbortSignal }} [options] `cancel`: what Cancel does
     *   besides aborting the job's signal; `signal`: stops the job as Cancel does
     * @returns {Promise<T>}
     */
    async run(label, detail, work, options = {}) {
      const controller = new AbortController();
      if (options.signal?.aborted) controller.abort();
      options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
      const job = {
        progress: /** @type {Progress} */ ({
          label,
          value: null,
          max: 1,
          detail,
          cancel: () => {
            options.cancel?.();
            controller.abort();
          },
        }),
      };
      running.add(job);
      render();
      /** @type {Running["report"]} */
      const report = (value, max = 1, words = job.progress.detail) => {
        if (!running.has(job)) return;
        job.progress = { ...job.progress, value, max: max > 0 ? max : 1, detail: words };
        if ([...running].at(-1) === job) render();
      };
      try {
        return await work({ signal: controller.signal, report });
      } finally {
        running.delete(job);
        render();
      }
    },
    /** Cancel every running job. */
    cancelAll() {
      for (const job of [...running]) job.progress.cancel();
    },
    get busy() {
      return running.size > 0;
    },
  };
}
