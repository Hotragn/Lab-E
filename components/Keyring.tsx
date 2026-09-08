"use client";

import { useRef } from "react";
import { policyFor } from "@/lib/domain/authority";
import { OPERATIONS } from "@/lib/domain/operations";
import { KEYRING, allowedRank, words } from "@/lib/copy";
import type { LabeState } from "@/lib/domain/types";
import type { BridgeStatus, RegisteredTool } from "@/lib/webmcp/bridge";
import { Button, Chip, Countdown, cx } from "./ui";
import { useCrossColumnMotion } from "./useCrossColumnMotion";

/**
 * The hero.
 *
 * This panel replaced a monospace tool list that sat below the fold while four
 * sparkline charts owned the first screen — which made the page read as yet
 * another analytics dashboard and buried the only interesting thing on it.
 *
 * Two columns, one question: what can this AI do, and what can it not. The
 * left column is dull on purpose. The right column is the argument, and the
 * moment an item crosses from right to left with a countdown attached is the
 * whole product in one gesture.
 */
export function Keyring({
  tools,
  state,
  now,
  status,
  onRunDemo,
  demoRunning,
}: {
  tools: RegisteredTool[];
  state: LabeState;
  now: number;
  status: BridgeStatus;
  onRunDemo: () => void;
  demoRunning: boolean;
}) {
  const surfaceRef = useRef<HTMLElement | null>(null);

  const base = tools
    .filter((t) => t.kind === "base")
    .slice()
    .sort((a, b) => allowedRank(a.operationId) - allowedRank(b.operationId));
  const granted = tools.filter((t) => t.kind === "granted");
  const grantedIds = new Set(granted.map((t) => t.operationId));

  const locked = OPERATIONS.filter((op) => {
    const policy = policyFor(state, op.id);
    return (policy === "grant" || policy === "forbidden") && !grantedIds.has(op.id);
  });

  // Recomputed on every render; the hook only acts when a row actually moved.
  const revision = tools
    .map((t) => `${t.kind}:${t.operationId}`)
    .sort()
    .join("|");
  useCrossColumnMotion(surfaceRef, revision);

  return (
    <section ref={surfaceRef} className="border border-rule bg-surface">
      {/* headline + scoreboard */}
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule px-5 py-4">
        <div>
          <h2 className="text-[19px] font-semibold leading-tight text-ink">
            {KEYRING.title}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            It only holds what you have handed over. Nothing else is within reach.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ink"
            onClick={onRunDemo}
            disabled={demoRunning}
            title="Watch it get blocked, ask, and be approved"
          >
            {demoRunning ? KEYRING.ctaRunning : `${KEYRING.cta} →`}
          </Button>
        </div>
      </header>

      <div className="grid gap-px bg-rule md:grid-cols-2">
        {/* ------------------------------ can do ----------------------------- */}
        <div className="bg-surface p-5">
          <div className="flex items-baseline gap-2">
            <span className="num text-[26px] font-semibold leading-none text-ink">
              {base.length + granted.length}
            </span>
            <span className="text-[13px] font-semibold text-ink">
              {KEYRING.allowed}
            </span>
            <span className="label ml-auto">
              {status.live ? "handed to the AI" : "no permission needed"}
            </span>
          </div>

          <ul className="mt-3.5 flex flex-col gap-1.5">
            {granted.map((t) => {
              const grant = state.grants.find((g) => g.id === t.grantId);
              const remaining = t.expiresAt ? t.expiresAt - now : 0;
              const usesLeft = grant
                ? Math.max(0, grant.maxUses - grant.usesConsumed)
                : t.usesLeft;
              return (
                <li
                  key={t.grantId}
                  data-motion-id={t.operationId}
                  className="border border-live/40 bg-live/6 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Tick tone="live" />
                    <span className="text-[13.5px] font-semibold text-live">
                      {words(t.operationId)}
                    </span>
                    <Chip tone="live">{KEYRING.approvedNow}</Chip>
                    <span className="ml-auto">
                      <Countdown
                        remainingMs={remaining}
                        totalMs={grant?.ttlMs ?? Math.max(remaining, 1)}
                      />
                    </span>
                  </div>
                  <p className="num mt-1 pl-5 text-[11px] text-ink-soft">
                    {Object.entries(t.pinned ?? {})
                      .map(([k, v]) => `only ${k}=${String(v)}`)
                      .join(" · ")}
                    {usesLeft !== undefined
                      ? `${Object.keys(t.pinned ?? {}).length ? " · " : ""}${usesLeft} use${usesLeft === 1 ? "" : "s"} left`
                      : ""}
                  </p>
                </li>
              );
            })}

            {base.map((t) => (
              <li
                key={t.name}
                data-motion-id={t.operationId}
                className="flex items-baseline gap-2 px-2.5"
              >
                <Tick tone="quiet" />
                <span className="text-[13px] text-ink">{words(t.operationId)}</span>
                <span className="num ml-auto text-[10.5px] text-ink-faint">
                  {t.name}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3.5 border-t border-rule pt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            None of these can break anything, so none of them need your
            permission.
          </p>
        </div>

        {/* ------------------------------ cannot ----------------------------- */}
        <div className="bg-sunken/40 p-5">
          <div className="flex items-baseline gap-2">
            <span className="num text-[26px] font-semibold leading-none text-ink-faint">
              {locked.length}
            </span>
            <span className="text-[13px] font-semibold text-ink">
              {KEYRING.locked}
            </span>
            <span className="label ml-auto">{KEYRING.lockedNote}</span>
          </div>

          <ul className="mt-3.5 flex flex-col gap-1.5">
            {locked.map((op) => {
              const never = policyFor(state, op.id) === "forbidden";
              return (
                <li
                  key={op.id}
                  data-motion-id={op.id}
                  className="flex items-baseline gap-2 px-2.5"
                >
                  <Lock never={never} />
                  <span
                    className={cx(
                      "text-[13px]",
                      never
                        ? "text-ink-faint line-through decoration-rule-strong"
                        : "text-ink-soft",
                    )}
                  >
                    {words(op.id)}
                  </span>
                  {never ? (
                    <Chip tone="deny">never</Chip>
                  ) : (
                    <span className="text-[10.5px] text-ink-faint">
                      needs your OK
                    </span>
                  )}
                  <span className="num ml-auto text-[10.5px] text-ink-faint">
                    {op.id}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-3.5 border-t border-rule pt-2.5 text-[11.5px] leading-relaxed text-ink-soft">
            The AI is not told &ldquo;no&rdquo; when it tries these. They are not
            in the list of things it can do, so there is nothing to try. Two of
            them you could not approve even if you wanted to.
          </p>
        </div>
      </div>
    </section>
  );
}

function Tick({ tone }: { tone: "live" | "quiet" }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={cx(
        "mt-[3px] size-3 shrink-0",
        tone === "live" ? "text-live" : "text-ink-faint",
      )}
    >
      <path
        d="M2 6.4l2.6 2.6L10 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Lock({ never }: { never: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={cx("mt-[3px] size-3 shrink-0", never ? "text-deny" : "text-ink-faint")}
    >
      <rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="currentColor" />
      <path
        d="M4.2 5.5V4a1.8 1.8 0 013.6 0v1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
