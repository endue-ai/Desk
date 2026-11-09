/**
 * The card that turns over (ADR 0129): its front and its back (Studio) share one place, and Studio
 * turns it around its vertical axis. The face away from the person is inert and hidden from
 * assistive technology, so the keyboard and a screen reader meet one face at a time; after a turn
 * the focus moves to the face now in front. With reduced motion the turn is instant (the motion
 * tokens are zero).
 */
import { type Child, h } from "../../shell/dom";

export interface FlipFaces {
  /** The view the card belongs to (`endue-agent:<id>`), named on the element for tests. */
  view: string;
  flipped: boolean;
  /** Whether the card turned since the last draw: only then does the focus move. */
  turned: boolean;
  frontLabel: string;
  backLabel: string;
  front: Child[];
  back: Child[];
  /** The face's accent: a #rrggbb colour, already checked. */
  colour?: string;
}

const face = (side: "front" | "back", away: boolean, label: string, children: Child[]) =>
  h(
    "section",
    {
      class: `endue-face endue-${side}`,
      "data-face": side,
      "aria-label": label,
      "aria-hidden": away ? "true" : undefined,
      inert: away,
    },
    ...children,
  );

export function flipCard(faces: FlipFaces): HTMLElement {
  const card = h(
    "div",
    {
      class: `endue-flip${faces.flipped ? " is-flipped" : ""}`,
      "data-flip": faces.view,
      ...(faces.colour ? { style: { "--endue-accent": faces.colour } } : {}),
    },
    h(
      "div",
      { class: "endue-flip-inner" },
      face("front", faces.flipped, faces.frontLabel, faces.front),
      face("back", !faces.flipped, faces.backLabel, faces.back),
    ),
  );
  if (faces.turned) {
    // After the element is in the document: the first control of the face now in front.
    queueMicrotask(() => {
      const shown = card.querySelector<HTMLElement>(
        `[data-face="${faces.flipped ? "back" : "front"}"] [data-flip-focus]`,
      );
      shown?.focus({ preventScroll: true });
    });
  }
  return card;
}
