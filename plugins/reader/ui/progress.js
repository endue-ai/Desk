// The same delayed progress element covers file opening and active page/chapter decoding.
/** @typedef {{ label: string, value: number | null, max: number, detail: string, cancel(): void }} Progress */
export function createProgress(element, status) {
  let opening = null;
  const jobs = new Map();
  let cancel = () => {};
  element?.addEventListener("desk-cancel", () => cancel());
  const render = () => {
    if (!element) return;
    const value = opening ?? [...jobs.values()].at(-1);
    element.hidden = !value;
    cancel = value?.cancel ?? (() => {});
    if (!value) return;
    element.label = value.label;
    element.value = value.value;
    element.max = value.max;
    element.detail = value.detail;
    element.cancelable = true;
  };
  return {
    /** @param {Progress | null} value */
    set(value) {
      opening = value;
      render();
    },
    clear() {
      for (const job of jobs.values()) job.cancel();
      jobs.clear();
      opening = null;
      render();
    },
    async run(detail, operation) {
      const controller = new AbortController();
      const { signal } = controller;
      const job = {
        label: "Decoding",
        value: null,
        max: 1,
        detail,
        cancel: () => controller.abort(),
      };
      jobs.set(controller, job);
      render();
      let abort;
      const stopped = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
      });
      try {
        return await Promise.race([operation(signal), stopped]);
      } catch (error) {
        if (signal.aborted && jobs.has(controller)) status(`Decoding ${detail} was cancelled.`);
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
        jobs.delete(controller);
        render();
      }
    },
  };
}
