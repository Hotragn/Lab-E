"use client";

import { WHAT_WHY } from "@/lib/copy";

/**
 * The what / why band, directly under the header.
 *
 * This sits above the console because a visitor needs to know what they are
 * looking at before the panels mean anything. Three short columns, no jargon,
 * no illustrations — readable in one pass, then ignored. The step-by-step
 * version lives in the "How it works" explainer so this stays light.
 */
export function WhatWhy() {
  return (
    <section
      aria-label="What this is and why it matters"
      className="border border-rule bg-surface"
    >
      <div className="grid gap-px bg-rule md:grid-cols-3">
        {[WHAT_WHY.what, WHAT_WHY.why, WHAT_WHY.how].map((block) => (
          <div key={block.title} className="bg-surface p-4">
            <h2 className="label">{block.title}</h2>
            <p className="mt-1.5 max-w-prose text-[12.5px] leading-relaxed text-ink-soft">
              {block.body}
            </p>
          </div>
        ))}
      </div>

    </section>
  );
}
