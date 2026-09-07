"use client";

import { useMemo, useState } from "react";
import { verifyLedger } from "@/lib/domain/ledger";
import type { LedgerEntry, LabeState } from "@/lib/domain/types";
import { Button, Chip, cx } from "./ui";

/**
 * The history.
 *
 * Append-only and hash-chained: each entry commits to its predecessor, so an
 * edit anywhere invalidates every hash after it, and the check button
 * recomputes all of it in the browser. Refusals are recorded as carefully as
 * successes, because the interesting question afterwards is usually what the AI
 * *tried* to do.
 */
export function LedgerPanel({ state }: { state: LabeState }) {
  const [showReads, setShowReads] = useState(false);
  const [verdictShown, setVerdictShown] = useState(false);

  const verdict = useMemo(() => verifyLedger(state.ledger), [state.ledger]);

  const entries = useMemo(() => {
    const list = showReads
      ? state.ledger
      : state.ledger.filter(
          (e) =>
            !["op.get_system_state", "op.read_telemetry", "op.list_operations"].includes(
              e.action,
            ),
        );
    return list.slice().reverse();
  }, [state.ledger, showReads]);

  const exportLedger = () => {
    const blob = new Blob([JSON.stringify(state.ledger, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labe-ledger-${state.ledger.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-4 py-2">
        <span className="text-[12px] text-ink-soft">
          Everything that happened, in order — including what the AI was refused.
        </span>
        <span className="num text-[11px] text-ink-faint">
          {state.ledger.length} entries · {verdict.ok ? verdict.head.slice(0, 12) : "—"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-soft">
            <input
              type="checkbox"
              checked={showReads}
              onChange={(e) => setShowReads(e.target.checked)}
              className="accent-human"
            />
            include every look
          </label>
          <Button
            size="xs"
            onClick={() => setVerdictShown(true)}
            title="Recompute every fingerprint to prove no entry was edited"
          >
            Check for tampering
          </Button>
          <Button size="xs" onClick={exportLedger}>
            Download
          </Button>
        </div>
      </div>

      {verdictShown ? (
        <div
          className={cx(
            "shrink-0 border-b px-4 py-2 text-[12px]",
            verdict.ok
              ? "border-live/30 bg-live/6 text-live"
              : "border-deny/30 bg-deny/6 text-deny",
          )}
        >
          {verdict.ok
            ? `Untouched. All ${verdict.length} entries check out.`
            : `Someone changed entry ${verdict.brokenAt}. The record is not trustworthy (${verdict.reason}).`}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-rule">
              {["#", "time", "who", "what happened", "result", "details", "fingerprint"].map((h) => (
                <th key={h} className="label px-3 py-1.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <Row key={entry.seq} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ entry }: { entry: LedgerEntry }) {
  const actorTone =
    entry.actor === "agent" ? "agent" : entry.actor === "human" ? "human" : "quiet";
  const outcomeTone =
    entry.outcome === "ok" ? "live" : entry.outcome === "denied" ? "deny" : "warn";

  const detail = Object.entries(entry.detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ");

  return (
    <tr
      className={cx(
        "border-b border-rule/60 align-top",
        entry.outcome === "denied" && "bg-deny/3",
      )}
    >
      <td className="num px-3 py-1.5 text-[11px] text-ink-faint">{entry.seq}</td>
      <td className="num px-3 py-1.5 text-[11px] text-ink-faint">
        {new Date(entry.ts).toISOString().slice(11, 19)}
      </td>
      <td className="px-3 py-1.5">
        <Chip tone={actorTone}>{entry.actor}</Chip>
      </td>
      <td className="num px-3 py-1.5 text-[12px] text-ink">
        {entry.action}
        {entry.tool ? (
          <span className="ml-1.5 text-[10px] text-ink-faint">via {entry.tool}</span>
        ) : null}
      </td>
      <td className="px-3 py-1.5">
        <Chip tone={outcomeTone}>{entry.outcome}</Chip>
      </td>
      <td className="num max-w-[34ch] break-words px-3 py-1.5 text-[11px] text-ink-soft">
        {detail || "—"}
      </td>
      <td
        className="num px-3 py-1.5 text-[11px] text-ink-faint"
        title={`hash ${entry.hash}\nprev ${entry.prevHash}`}
      >
        {entry.hash.slice(0, 8)}
      </td>
    </tr>
  );
}
