/**
 * Views a host draws itself, beside the compositor's surfaces: the shell's panes. Focus cycling
 * (desk.display) goes through them first, and each is a buffer (desk.buffers), so switching,
 * cycling and closing buffers reach them as they reach plugin surfaces.
 */
import type { BuffersPolicy } from "./policies/buffers";

export interface HostViews {
  /** View ids in reading order. */
  ids(): string[];
  focused(): string | null;
  focus(id: string): void;
  /** What a view shows, as the buffer list names it. */
  title(id: string): string;
  /** Close a view: desk.buffers.close on its buffer. */
  close(id: string): void;
  /** Hear when views open, close, change what they show or take the focus. */
  onChange(listener: () => void): () => void;
}

export interface ViewRouting {
  owns(id: string): boolean;
  dispose(): void;
}

/** Keep the buffer list in step with the host's views. */
export function connectViews(views: HostViews | undefined, buffers: BuffersPolicy): ViewRouting {
  if (!views) return { owns: () => false, dispose: () => {} };
  let known = new Set<string>();
  let focused: string | null = null;
  const sync = () => {
    const ids = views.ids();
    for (const id of known) if (!ids.includes(id)) buffers.surfaceClosed(id);
    for (const id of ids) {
      if (known.has(id)) buffers.buffers.update(`surface:${id}`, { name: views.title(id) });
      else buffers.surfaceOpened(id, views.title(id));
    }
    known = new Set(ids);
    const now = views.focused();
    if (now !== focused) buffers.focused(now);
    focused = now;
  };
  sync();
  return { owns: (id) => known.has(id), dispose: views.onChange(sync) };
}
