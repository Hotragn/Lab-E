"use client";

import { useState } from "react";
import { describeGrant, liveGrants } from "@/lib/domain/authority";
import { getOperation } from "@/lib/domain/operations";
import type { Action } from "@/lib/domain/store";
import type { AuthorityGrant, OpResult, LabeState } from "@/lib/domain/types";
import { LABELS, PANELS } from "@/lib/copy";
import { Button, Chip, Empty, Panel, inputClass } from "./ui";

/**
 * The approval surface.
 *
 * An agent can ask for authority; only a person can issue it. The operator can
 * also tighten what was asked for before approving — fewer uses, less time, a
 * lower ceiling — which is the difference between an approval workflow and a
 * rubber stamp.
 */
export function AuthorityInbox({
  state,
  now,
  dispatch,
}: {
  state: LabeState;
  now: number;
  dispatch: (action: Action) => OpResult;
}) {
  const pending = state.grants.filter((g) => g.status === "pending");
  const live = liveGrants(state.grants, now);

  // Idle is the normal state, so it should cost one line rather than a panel.
  // A tall empty box here pushed the rest of the page down for no information.
  if (pending.length === 0 && live.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border border-rule bg-surface px-4 py-2.5">
        <span className="text-[13px] font-semibold text-ink">
          {PANELS.approvals.title}
        </span>
        <span className="label">{PANELS.approvals.sub}</span>
        <span className="ml-auto text-[12px] text-ink-soft">
          Nothing pending. The AI has to come here before it can do anything
          risky.
        </span>
      </div>
    );
  }

  return (
    <Panel
      title={PANELS.approvals.title}
      sub={PANELS.approvals.sub}
      meta={
        pending.length ? (
          <Chip tone="warn">{pending.length} to decide</Chip>
        ) : (
          <span className="text-[11px] text-ink-faint">nothing to decide</span>
        )
      }
    >
      {pending.length === 0 && live.length === 0 ? (
        <Empty>
          The AI asks here before doing anything risky. Nothing is pending.
        </Empty>
      ) : null}

      <div className="flex flex-col gap-3">
        {pending.map((grant) => (
          <PendingCard key={grant.id} grant={grant} dispatch={dispatch} />
        ))}
      </div>

      {live.length > 0 ? (
        <div className="mt-4 border-t border-rule pt-3">
          <span className="text-[12.5px] font-medium text-ink">
            What you have approved
          </span>
          <div className="mt-2 flex flex-col gap-1.5">
            {live.map((grant) => (
              <div
                key={grant.id}
                className="flex items-center justify-between gap-3"
              >
                <span className="num text-[11px] text-ink-soft">
                  {describeGrant(grant, now)}
                </span>
                <Button
                  size="xs"
                  variant="deny"
                  onClick={() =>
                    dispatch({ type: "grant.revoke", at: Date.now(), grantId: grant.id })
                  }
                  title="Take this back now. The tool disappears immediately."
                >
                  {LABELS.revoke}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function PendingCard({
  grant,
  dispatch,
}: {
  grant: AuthorityGrant;
  dispatch: (action: Action) => OpResult;
}) {
  const op = getOperation(grant.operationId);
  const capKeys = Object.keys(grant.caps);

  const [maxUses, setMaxUses] = useState(String(grant.maxUses));
  const [ttlSeconds, setTtlSeconds] = useState(String(Math.round(grant.ttlMs / 1000)));
  const [caps, setCaps] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(grant.caps).map(([k, v]) => [k, String(v)])),
  );

  const approve = () => {
    dispatch({
      type: "grant.approve",
      at: Date.now(),
      grantId: grant.id,
      tighten: {
        maxUses: Math.max(1, Number(maxUses) || 1),
        ttlMs: Math.max(30, Number(ttlSeconds) || 300) * 1000,
        caps: Object.fromEntries(
          Object.entries(caps)
            .map(([k, v]) => [k, Number(v)])
            .filter(([, v]) => Number.isFinite(v as number)),
        ) as Record<string, number>,
      },
    });
  };

  return (
    <article className="arrive border border-warn/40 bg-warn/4 p-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="num text-[13px] font-semibold text-ink">
            {grant.operationId}
            <span className="mx-1.5 text-ink-faint">→</span>
            {grant.scopeRef}
          </div>
          <p className="mt-1 max-w-prose text-[12px] italic text-ink-soft">
            &ldquo;{grant.reason}&rdquo;
          </p>
        </div>
        <Chip tone="agent">{grant.requestedBy}</Chip>
      </header>

      {op ? (
        <p className="mt-2 border-l-2 border-deny/50 pl-2 text-[11px] leading-relaxed text-ink-soft">
          <span className="label mr-1">{LABELS.ifThisRuns}</span>
          {op.blastRadius}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">uses</span>
          <input
            className={`${inputClass} w-14`}
            value={maxUses}
            inputMode="numeric"
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">ttl (s)</span>
          <input
            className={`${inputClass} w-20`}
            value={ttlSeconds}
            inputMode="numeric"
            onChange={(e) => setTtlSeconds(e.target.value)}
          />
        </label>
        {capKeys.map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="label">{k} ≤</span>
            <input
              className={`${inputClass} w-16`}
              value={caps[k] ?? ""}
              inputMode="numeric"
              onChange={(e) => setCaps({ ...caps, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>

      <footer className="mt-3 flex items-center gap-2">
        <Button
          variant="human"
          onClick={approve}
          title="Allow this one action, on this one item"
        >
          {LABELS.approve}
        </Button>
        <Button
          variant="deny"
          onClick={() =>
            dispatch({
              type: "grant.deny",
              at: Date.now(),
              grantId: grant.id,
              reason: "Operator declined.",
            })
          }
        >
          {LABELS.deny}
        </Button>
        <span className="ml-auto text-[11px] text-ink-faint">
          Approving lets it touch {grant.scopeRef} and nothing else.
        </span>
      </footer>
    </article>
  );
}
