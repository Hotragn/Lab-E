"use client";

import { policyFor } from "@/lib/domain/authority";
import { OPERATIONS } from "@/lib/domain/operations";
import type { Action } from "@/lib/domain/store";
import type { OpResult, LabeState, PolicyClass } from "@/lib/domain/types";
import { POLICY_WORDS } from "@/lib/copy";
import { Chip, cx } from "./ui";

/** Short words for the toggle, full words for the legend cards. */
const CLASSES: {
  value: PolicyClass;
  label: string;
  short: string;
  note: string;
  technical: string;
}[] = [
  {
    value: "auto",
    label: POLICY_WORDS.auto.label,
    short: "always",
    note: POLICY_WORDS.auto.note,
    technical: "registered permanently",
  },
  {
    value: "grant",
    label: POLICY_WORDS.grant.label,
    short: "ask me",
    note: POLICY_WORDS.grant.note,
    technical: "registered only while a grant lives",
  },
  {
    value: "forbidden",
    label: POLICY_WORDS.forbidden.label,
    short: "never",
    note: POLICY_WORDS.forbidden.note,
    technical: "never registered",
  },
];

/**
 * The rules.
 *
 * Who is allowed to do what should be something a person can read and change,
 * not a condition buried in code. Tightening a rule here takes back any live
 * approval for it, which removes the tool before the AI's next call.
 */
export function PolicyPanel({
  state,
  dispatch,
}: {
  state: LabeState;
  dispatch: (action: Action) => OpResult;
}) {
  return (
    <div className="min-h-0 overflow-y-auto scroll-thin p-4">
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {CLASSES.map((c) => (
          <div key={c.value} className="border border-rule bg-sunken/50 p-2.5">
            <Chip tone={c.value === "forbidden" ? "deny" : c.value === "grant" ? "warn" : "live"}>
              {c.label}
            </Chip>
            <p className="label mt-1.5">{c.technical}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">{c.note}</p>
          </div>
        ))}
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-rule">
            {["action", "risk", "if it runs", "who can do it"].map((h) => (
              <th key={h} className="label px-2 py-1.5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OPERATIONS.map((op) => {
            const current = policyFor(state, op.id);
            return (
              <tr key={op.id} className="border-b border-rule/60 align-middle">
                <td className="num px-2 py-2 text-[12px] text-ink">{op.id}</td>
                <td className="px-2 py-2">
                  <Chip
                    tone={
                      op.risk === "irreversible"
                        ? "deny"
                        : op.risk === "mutate"
                          ? "warn"
                          : "quiet"
                    }
                  >
                    {op.risk}
                  </Chip>
                </td>
                <td className="max-w-[42ch] px-2 py-2 text-[11px] leading-relaxed text-ink-soft">
                  {op.blastRadius}
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-px border border-rule-strong">
                    {CLASSES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          dispatch({
                            type: "policy.set",
                            at: Date.now(),
                            actor: "human",
                            operationId: op.id,
                            value: c.value,
                          })
                        }
                        className={cx(
                          "num px-2 py-1 text-[10px] uppercase tracking-wider transition-colors",
                          current === c.value
                            ? c.value === "forbidden"
                              ? "bg-deny text-white"
                              : c.value === "grant"
                                ? "bg-warn text-white"
                                : "bg-live text-white"
                            : "bg-surface text-ink-faint hover:bg-sunken",
                        )}
                      >
                        {c.short}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
