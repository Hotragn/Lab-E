"use client";

import { getOperation } from "@/lib/domain/operations";
import type { Action } from "@/lib/domain/store";
import type { Incident, OpResult, LabeState } from "@/lib/domain/types";
import { LABELS, PANELS } from "@/lib/copy";
import { Button, Chip, Empty, Panel, cx } from "./ui";

/**
 * The incident and whatever the agent has proposed about it.
 *
 * Findings and drafts are the agent's half of the work: it can write down what
 * it believes and what it would do, freely and reversibly. Executing the plan
 * is a separate act that needs authority.
 */
export function IncidentPanel({
  state,
  now,
  dispatch,
}: {
  state: LabeState;
  now: number;
  dispatch: (action: Action) => OpResult;
}) {
  const incident = state.incidents[0];

  return (
    <Panel
      title={PANELS.incident.title}
      sub={PANELS.incident.sub}
      meta={
        incident ? (
          <span className="flex items-center gap-1.5">
            <Chip tone={incident.severity === "sev1" ? "deny" : "warn"}>
              {incident.severity}
            </Chip>
            <Chip tone={incident.status === "open" ? "deny" : "live"}>
              {incident.status}
            </Chip>
          </span>
        ) : null
      }
    >
      {!incident ? (
        <Empty>No open incidents.</Empty>
      ) : (
        <>
          <h3 className="text-[15px] font-semibold leading-snug text-ink">
            {incident.title}
          </h3>
          <p className="num mt-0.5 text-[11px] text-ink-faint">
            {incident.id} · {incident.serviceId} · open{" "}
            {Math.round((now - incident.openedAt) / 60000)}m
          </p>

          <Timeline incident={incident} />
        </>
      )}

      <div className="mt-4 border-t border-rule pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink">
            {LABELS.suggestedFix}
          </span>
          <span className="num text-[11px] text-ink-faint">
            {state.remediations.length}
          </span>
        </div>

        {state.remediations.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-faint">
            Nothing yet. The AI can write up a fix here for free — writing it
            down does not run any of it.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {state.remediations.map((rem) => (
              <article key={rem.id} className="border border-rule bg-sunken/60 p-2.5">
                <header className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-medium text-ink">{rem.summary}</span>
                  <Chip tone={rem.author === "agent" ? "agent" : "human"}>
                    {rem.author}
                  </Chip>
                </header>
                <ol className="mt-2 flex flex-col gap-1">
                  {rem.steps.map((step, i) => {
                    const op = getOperation(step.operationId);
                    const needsGrant =
                      (state.policy[step.operationId] ?? "grant") === "grant";
                    return (
                      <li key={i} className="flex items-baseline gap-2">
                        <span className="num text-[10px] text-ink-faint">{i + 1}</span>
                        <span className="num text-[12px] text-ink">
                          {step.operationId}
                        </span>
                        {Object.entries(step.params).length ? (
                          <span className="num text-[11px] text-ink-faint">
                            {Object.entries(step.params)
                              .map(([k, v]) => `${k}=${String(v)}`)
                              .join(" ")}
                          </span>
                        ) : null}
                        {needsGrant ? <Chip tone="warn">{LABELS.needsOk}</Chip> : null}
                        {op?.reversible === false ? (
                          <Chip tone="deny">cannot be undone</Chip>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {rem.steps[0]?.rationale ? (
                  <p className="mt-1.5 text-[11px] italic text-ink-soft">
                    {rem.steps[0].rationale}
                  </p>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <Button
                    size="xs"
                    onClick={() =>
                      dispatch({
                        type: "op.execute",
                        at: Date.now(),
                        actor: "human",
                        operationId: "annotate_incident",
                        params: {
                          incidentId: rem.incidentId,
                          body: `Operator reviewed ${rem.id}: ${rem.summary}`,
                          kind: "note",
                        },
                      })
                    }
                  >
                    Mark reviewed
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Timeline({ incident }: { incident: Incident }) {
  return (
    <ol className="mt-3 flex flex-col border-l border-rule pl-3">
      {incident.notes.map((note) => (
        <li key={note.id} className="relative py-1.5">
          <span
            aria-hidden
            className={cx(
              "absolute -left-[17px] top-3 size-1.5 rounded-full",
              note.actor === "agent"
                ? "bg-agent"
                : note.actor === "human"
                  ? "bg-human"
                  : "bg-ink-faint",
            )}
          />
          <div className="flex items-baseline gap-2">
            <span
              className={cx(
                "label",
                note.actor === "agent"
                  ? "text-agent"
                  : note.actor === "human"
                    ? "text-human"
                    : "text-ink-faint",
              )}
            >
              {note.actor} · {note.kind}
            </span>
            <span className="num text-[10px] text-ink-faint">
              {new Date(note.at).toISOString().slice(11, 19)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink">{note.body}</p>
        </li>
      ))}
    </ol>
  );
}
