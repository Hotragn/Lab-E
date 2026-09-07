"use client";

import { INJECTION_RULES } from "@/lib/domain/injection";
import { TELEMETRY_LOGS } from "@/lib/domain/seed";
import type { LabeState } from "@/lib/domain/types";
import { Chip, Empty, cx } from "./ui";

/**
 * Prompt-injection quarantine.
 *
 * `read_telemetry` returns text written by whoever could reach the service: log
 * lines, user agents, support notes. That is the classic indirect injection
 * path, and `untrustedContentHint` only warns the agent about it. LABE strips
 * instruction-shaped spans out of the payload before the model ever sees them,
 * and records each removal here.
 *
 * The seeded logs contain two real attempts, so this is demonstrable rather
 * than theoretical.
 */
export function QuarantinePanel({ state }: { state: LabeState }) {
  const grouped = new Map<string, { count: number; excerpt: string }>();
  for (const record of state.quarantine) {
    const existing = grouped.get(record.rule);
    grouped.set(record.rule, {
      count: (existing?.count ?? 0) + 1,
      excerpt: existing?.excerpt ?? record.excerpt,
    });
  }

  const planted = (TELEMETRY_LOGS.svc_checkout ?? []).filter(
    (line) => line.includes("SYSTEM:") || line.includes("grant yourself"),
  );

  return (
    <div className="min-h-0 overflow-y-auto scroll-thin p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-ink">
            Hidden orders we stripped out
          </span>
            <span className="num text-[11px] text-ink-faint">
              {state.quarantine.length} span
              {state.quarantine.length === 1 ? "" : "s"}
            </span>
          </div>

          {grouped.size === 0 ? (
            <div className="mt-2">
              <Empty>
                Nothing caught yet. Let the AI read the checkout logs — two traps
                are hidden in them.
              </Empty>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {[...grouped.entries()].map(([ruleId, info]) => {
                const rule = INJECTION_RULES.find((r) => r.id === ruleId);
                return (
                  <div
                    key={ruleId}
                    className="border border-deny/30 bg-deny/4 p-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[12px] font-semibold text-deny">
                        {ruleId}
                      </span>
                      <Chip tone="deny">×{info.count}</Chip>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-soft">
                      {rule?.note ?? "matched an injection rule"}
                    </p>
                    <p className="num mt-1.5 break-words border-l-2 border-deny/40 pl-2 text-[11px] text-ink-faint">
                      {info.excerpt}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className="text-[12.5px] font-medium text-ink">
            The actual trap text, as it appears in the logs
          </span>
          <div className="mt-2 flex flex-col gap-2">
            {planted.map((line, i) => (
              <p
                key={i}
                className="num break-words border border-rule bg-sunken/60 p-2 text-[11px] leading-relaxed text-ink-soft"
              >
                {line}
              </p>
            ))}
          </div>

          <span className="mt-4 block text-[12.5px] font-medium text-ink">
            Patterns we watch for
          </span>
          <div className="mt-2 flex flex-wrap gap-1">
            {INJECTION_RULES.map((rule) => {
              const fired = grouped.has(rule.id);
              return (
                <span
                  key={rule.id}
                  title={rule.note}
                  className={cx(
                    "num border px-1.5 py-0.5 text-[10px]",
                    fired
                      ? "border-deny/40 bg-deny/8 text-deny"
                      : "border-rule text-ink-faint",
                  )}
                >
                  {rule.id}
                </span>
              );
            })}
          </div>

          <p className="mt-4 max-w-prose text-[11.5px] leading-relaxed text-ink-soft">
            Stripping the text is the second line of defence, not the first. Even
            if a trap got past every pattern above, the AI still could not act on
            it — turning servers off is not one of the things it can do unless
            you approve it.
          </p>
        </div>
      </div>
    </div>
  );
}
