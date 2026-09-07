"use client";

import { BRAND, HOW_IT_WORKS } from "@/lib/copy";
import { Button } from "./ui";

/**
 * First-run explainer.
 *
 * Deliberately small: three sentences and two buttons. A reviewer who lands
 * here has about ten seconds of patience, and a wall of text spends all of it.
 * Dismissed state is remembered, and the header keeps a way back in.
 *
 * The layout is defensive about height. Centring a fixed-height card inside
 * `inset-0` clips it at *both* ends once the viewport is shorter than the card,
 * which put the buttons out of reach in ChatGPT's in-app browser and in any
 * short window. So: the overlay scrolls, the card is capped to the viewport,
 * and the footer is pinned inside the card — the buttons are always reachable.
 */
export function Onboarding({
  open,
  onClose,
  onStartTour,
}: {
  open: boolean;
  onClose: () => void;
  onStartTour: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain p-3 sm:p-4"
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 bg-ink/25 backdrop-blur-[2px]"
      />

      <div className="relative mx-auto flex min-h-full max-w-[34rem] items-center">
        <div className="flex max-h-[calc(100dvh-1.5rem)] w-full flex-col border border-rule-strong bg-surface shadow-[0_1px_0_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)] sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex shrink-0 items-start gap-3 border-b border-rule px-5 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/labe-mark.svg"
              alt=""
              width={32}
              height={32}
              className="mt-0.5 hidden shrink-0 sm:block"
            />
            <div>
              <h2 id="onboarding-title" className="text-[15px] font-semibold text-ink">
                {BRAND.tagline}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
                {BRAND.standfirst}
              </p>
            </div>
          </div>

          {/* The only part allowed to scroll, so the footer never leaves. */}
          <ol className="scroll-thin flex min-h-0 flex-1 flex-col divide-y divide-rule overflow-y-auto">
            {HOW_IT_WORKS.map((step) => (
              <li key={step.n} className="flex shrink-0 gap-3 px-5 py-3">
                <span className="num mt-px flex size-5 shrink-0 items-center justify-center border border-rule-strong text-[11px] text-ink-soft">
                  {step.n}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">{step.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule bg-sunken/60 px-5 py-3">
            <Button variant="ink" onClick={onStartTour}>
              Show me — run the demo
            </Button>
            <Button onClick={onClose}>I&rsquo;ll look around</Button>
            <span className="ml-auto hidden text-[11px] text-ink-faint sm:block">
              Nothing here is a real system.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
