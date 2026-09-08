"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Animate rows that changed position between renders (a FLIP).
 *
 * Why this exists: the moment an operation crosses from "It cannot" to "It can"
 * is the entire product in one gesture, and a fade-in does not convey it. This
 * makes the row visibly travel from where it used to be to where it now is.
 *
 * The trick is that FLIP does not need DOM-node identity — only the previous
 * rectangle for a given logical id. The two columns render different markup, so
 * React unmounts the locked row and mounts a granted one; because we key the
 * measurement by `data-motion-id` rather than by node, the *new* node animates
 * out of the *old* node's position and the swap reads as movement.
 *
 * Runs in `useLayoutEffect`, before paint, so there is no frame where the row
 * appears in its final spot first.
 */
export function useCrossColumnMotion(
  container: React.RefObject<HTMLElement | null>,
  /** Changes to this value mark a render worth comparing. */
  revision: unknown,
): void {
  const previous = useRef(new Map<string, DOMRect>());
  const isFirstPass = useRef(true);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const nodes = root.querySelectorAll<HTMLElement>("[data-motion-id]");
    const next = new Map<string, DOMRect>();

    for (const node of nodes) {
      const id = node.dataset.motionId;
      if (!id) continue;

      const rect = node.getBoundingClientRect();
      next.set(id, rect);

      // Nothing to animate from on the very first measurement pass.
      //
      // The visibility check is not an optimisation. This animation works by
      // displacing the row from its real layout position and easing it back,
      // and a hidden document pauses the animation timeline — so the row would
      // sit parked on the first keyframe, visibly in the wrong column, until
      // the tab was looked at again. If nobody is watching there is nothing to
      // animate, and skipping avoids the stuck-transform state entirely.
      if (
        isFirstPass.current ||
        reduceMotion ||
        document.visibilityState !== "visible"
      ) {
        continue;
      }

      const old = previous.current.get(id);
      if (!old) continue;

      const dx = old.left - rect.left;
      const dy = old.top - rect.top;

      // A couple of pixels of drift is layout noise, not a move.
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) continue;

      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.5 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        { duration: 440, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
      );
    }

    previous.current = next;
    isFirstPass.current = false;
  }, [container, revision]);
}
