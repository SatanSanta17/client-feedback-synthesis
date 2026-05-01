"use client";

import { useEffect, useState } from "react";

type ScrollRevealCallbackRef = (node: HTMLDivElement | null) => void;

/**
 * Triggers a one-shot reveal when the attached element scrolls into view.
 *
 * Returns a tuple of `[scrollRef, isVisible]` — attach `scrollRef` to the
 * target element via the standard React `ref` prop. `isVisible` flips to
 * `true` the first time the element intersects the viewport (>= 10% visible)
 * and stays `true` thereafter — the observer disconnects on first intersection
 * so animations do not retrigger on scroll-out / scroll-in.
 *
 * Used by the public landing page to drive scroll-reveal animations on the
 * features grid, how-it-works steps, product showcase, personas, and contact
 * sections.
 */
export function useScrollReveal(): [ScrollRevealCallbackRef, boolean] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, isVisible];
}
