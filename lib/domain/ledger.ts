import { sha256Hex } from "./sha256";
import type { Actor, LedgerEntry, Outcome } from "./types";

/** Deterministic JSON: sorted keys, so the same detail always hashes alike. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

export const GENESIS_HASH = "0".repeat(64);

function canonical(e: Omit<LedgerEntry, "hash">): string {
  return [
    e.seq,
    e.ts,
    e.actor,
    e.action,
    e.tool ?? "",
    e.outcome,
    stableStringify(e.detail),
    e.prevHash,
  ].join("|");
}

export interface LedgerDraft {
  actor: Actor;
  action: string;
  tool?: string;
  outcome: Outcome;
  detail?: Record<string, unknown>;
  ts: number;
}

/**
 * Append one tamper-evident entry. Each entry commits to its predecessor, so
 * editing history requires rewriting every hash after the edit — which
 * `verifyLedger` will report. This is what makes "the agent did X" auditable
 * rather than merely logged.
 */
export function appendEntry(ledger: LedgerEntry[], draft: LedgerDraft): LedgerEntry {
  const prev = ledger[ledger.length - 1];
  const base: Omit<LedgerEntry, "hash"> = {
    seq: prev ? prev.seq + 1 : 1,
    ts: draft.ts,
    actor: draft.actor,
    action: draft.action,
    tool: draft.tool,
    outcome: draft.outcome,
    detail: draft.detail ?? {},
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return { ...base, hash: sha256Hex(canonical(base)) };
}

export type LedgerVerdict =
  | { ok: true; length: number; head: string }
  | { ok: false; brokenAt: number; reason: "hash" | "link" | "sequence" };

/** Re-derive every hash and every link. Exposed to agents and to the UI. */
export function verifyLedger(ledger: LedgerEntry[]): LedgerVerdict {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.seq !== i + 1) return { ok: false, brokenAt: e.seq, reason: "sequence" };
    if (e.prevHash !== prevHash) return { ok: false, brokenAt: e.seq, reason: "link" };
    const { hash, ...rest } = e;
    if (sha256Hex(canonical(rest)) !== hash)
      return { ok: false, brokenAt: e.seq, reason: "hash" };
    prevHash = hash;
  }
  return { ok: true, length: ledger.length, head: prevHash };
}
