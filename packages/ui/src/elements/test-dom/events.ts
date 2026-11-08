// The events of the test DOM: what the elements dispatch and the tests press.
import type { FakeNode } from "./nodes";

type Init = { bubbles?: boolean; cancelable?: boolean; composed?: boolean };

export class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  relatedTarget: FakeNode | null = null;
  defaultPrevented = false;
  stopped = false;
  stoppedNow = false;
  path: FakeNode[] = [];

  constructor(type: string, init: Init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.composed = init.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  stopImmediatePropagation(): void {
    this.stopped = true;
    this.stoppedNow = true;
  }

  composedPath(): FakeNode[] {
    return [...this.path];
  }
}

export class FakeCustomEvent extends FakeEvent {
  readonly detail: unknown;
  constructor(type: string, init: Init & { detail?: unknown } = {}) {
    super(type, init);
    this.detail = init.detail ?? null;
  }
}

export class FakeKeyboardEvent extends FakeEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  constructor(type: string, init: Init & { key?: string; shiftKey?: boolean } = {}) {
    super(type, init);
    this.key = init.key ?? "";
    this.shiftKey = init.shiftKey ?? false;
  }
}

export class FakeFocusEvent extends FakeEvent {
  constructor(type: string, init: Init & { relatedTarget?: FakeNode | null } = {}) {
    super(type, init);
    this.relatedTarget = init.relatedTarget ?? null;
  }
}
