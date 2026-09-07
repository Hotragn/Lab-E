import { describe, expect, it } from "vitest";
import {
  appendEntry,
  GENESIS_HASH,
  stableStringify,
  verifyLedger,
} from "./ledger";
import type { LedgerEntry } from "./types";

function chain(n: number): LedgerEntry[] {
  const ledger: LedgerEntry[] = [];
  for (let i = 0; i < n; i++) {
    ledger.push(
      appendEntry(ledger, {
        ts: 1_700_000_000_000 + i * 1000,
        actor: i % 2 === 0 ? "agent" : "human",
        action: `op.step_${i}`,
        outcome: "ok",
        detail: { i, note: `entry ${i}` },
      }),
    );
  }
  return ledger;
}

describe("stableStringify", () => {
  it("is independent of key insertion order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("recurses through nested objects and arrays", () => {
    expect(stableStringify({ z: [{ y: 1, x: 2 }] })).toBe('{"z":[{"x":2,"y":1}]}');
  });
});

describe("ledger chain", () => {
  it("links the first entry to the genesis hash", () => {
    const ledger = chain(1);
    expect(ledger[0].seq).toBe(1);
    expect(ledger[0].prevHash).toBe(GENESIS_HASH);
  });

  it("verifies an untouched chain", () => {
    const verdict = verifyLedger(chain(12));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.length).toBe(12);
  });

  it("verifies an empty ledger", () => {
    expect(verifyLedger([]).ok).toBe(true);
  });

  it("detects an edited payload at the entry that was edited", () => {
    const ledger = chain(8);
    ledger[4] = { ...ledger[4], detail: { i: 4, note: "tampered" } };
    const verdict = verifyLedger(ledger);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.brokenAt).toBe(5);
      expect(verdict.reason).toBe("hash");
    }
  });

  it("detects a silently rewritten actor", () => {
    const ledger = chain(5);
    ledger[2] = { ...ledger[2], actor: "human" };
    const verdict = verifyLedger(ledger);
    expect(verdict.ok).toBe(false);
  });

  it("detects a deleted entry as a broken link", () => {
    const ledger = chain(6);
    const spliced = [...ledger.slice(0, 3), ...ledger.slice(4)];
    const verdict = verifyLedger(spliced);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("sequence");
  });

  it("detects a re-signed entry whose link no longer matches", () => {
    const ledger = chain(4);
    // Re-hash entry 3 correctly for a forged predecessor: the link check
    // must still catch that it no longer follows entry 2.
    const forged = appendEntry(ledger.slice(0, 1), {
      ts: ledger[2].ts,
      actor: ledger[2].actor,
      action: ledger[2].action,
      outcome: "ok",
      detail: ledger[2].detail,
    });
    ledger[2] = { ...forged, seq: 3 };
    const verdict = verifyLedger(ledger);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("link");
  });
});
