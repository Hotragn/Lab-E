import { beforeEach, describe, expect, it } from "vitest";
import { QUARANTINE_MARK } from "./injection";
import { verifyLedger } from "./ledger";
import { createSeedState } from "./seed";
import { createStore, operationDigest, reduce, snapshot, type Action } from "./store";
import type { LabeState } from "./types";

const T0 = 1_800_000_000_000;
const SEC = 1000;

let state: LabeState;

beforeEach(() => {
  state = createSeedState(T0);
});

/** Run a list of actions, threading state. Returns the final state + results. */
function run(initial: LabeState, actions: Action[]) {
  let s = initial;
  const results = actions.map((a) => {
    const r = reduce(s, a);
    s = r.state;
    return r.result;
  });
  return { state: s, results, last: results[results.length - 1] };
}

const agentExec = (
  operationId: string,
  params: Record<string, string | number | boolean>,
  at = T0,
): Action => ({ type: "op.execute", at, actor: "agent", operationId, params, via: operationId });

const humanExec = (
  operationId: string,
  params: Record<string, string | number | boolean>,
  at = T0,
): Action => ({ type: "op.execute", at, actor: "human", operationId, params });

/** The canonical demo path: ask, get approved, act once. */
function grantedRollback(at = T0) {
  return run(state, [
    {
      type: "grant.request",
      at,
      req: {
        operationId: "rollback_deploy",
        scopeRef: "dpl_9c1f",
        reason: "cart totals regressed in 9c1f4ab",
        requestedBy: "agent",
        maxUses: 1,
        ttlMs: 300 * SEC,
      },
    },
    { type: "grant.approve", at: at + SEC, grantId: "gr_0002" },
  ]);
}

describe("seed state", () => {
  it("opens on a live incident rather than an empty board", () => {
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].status).toBe("open");
    expect(state.services.find((s) => s.id === "svc_checkout")?.health).toBe("degraded");
  });

  it("ships a ledger that already verifies", () => {
    expect(verifyLedger(state.ledger).ok).toBe(true);
    expect(state.ledger.length).toBeGreaterThan(0);
  });
});

describe("the authority gate", () => {
  it("refuses an agent rollback when no authority has been granted", () => {
    const { state: next, last } = run(state, [
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "spike" }),
    ]);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.hint).toMatch(/request_authority/);

    // The active deployment is untouched.
    expect(next.deploys.find((d) => d.id === "dpl_9c1f")?.active).toBe(true);
  });

  it("records the refusal in the ledger, so nothing is silent", () => {
    const { state: next } = run(state, [
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "spike" }),
    ]);
    const denial = next.ledger.at(-1);
    expect(denial?.outcome).toBe("denied");
    expect(denial?.actor).toBe("agent");
    expect(denial?.detail.code).toBe("authority_absent");
    expect(verifyLedger(next.ledger).ok).toBe(true);
  });

  it("creates a pending grant that does not yet authorise anything", () => {
    const { state: next, last } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "rollback_deploy",
          scopeRef: "dpl_9c1f",
          reason: "regression",
          requestedBy: "agent",
        },
      },
    ]);
    expect(last.ok).toBe(true);
    expect(next.grants[0].status).toBe("pending");

    const blocked = reduce(
      next,
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }),
    );
    expect(blocked.result.ok).toBe(false);
  });

  it("performs the rollback once a human approves, and heals the service", () => {
    const armed = grantedRollback().state;
    const { state: next, last } = run(armed, [
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "NaN in totals" }, T0 + 5 * SEC),
    ]);

    expect(last.ok).toBe(true);
    expect(next.deploys.find((d) => d.id === "dpl_9c1f")?.active).toBe(false);
    expect(next.deploys.find((d) => d.id === "dpl_7a30")?.active).toBe(true);

    const svc = next.services.find((s) => s.id === "svc_checkout")!;
    expect(svc.health).toBe("healthy");
    expect(svc.errorRatePct).toBeLessThan(1);

    expect(next.incidents[0].status).toBe("mitigated");
  });

  it("spends the grant, so a second identical call is refused", () => {
    const armed = grantedRollback().state;
    const first = reduce(
      armed,
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }, T0 + 5 * SEC),
    );
    expect(first.result.ok).toBe(true);
    expect(first.state.grants[0].status).toBe("exhausted");

    const second = reduce(
      first.state,
      agentExec("rollback_deploy", { deployId: "dpl_7a30", reason: "r" }, T0 + 6 * SEC),
    );
    expect(second.result.ok).toBe(false);
  });

  it("does not spend the grant when the operation itself fails", () => {
    // Authority is spent on work done, not on attempts. A call that fails for a
    // domain reason must leave the operator's grant intact, or a single
    // fat-fingered argument silently costs them their authorisation.
    const armed = grantedRollback().state;
    const first = reduce(
      armed,
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }, T0 + 5 * SEC),
    );
    expect(first.result.ok).toBe(true);
    expect(first.state.grants[0].usesConsumed).toBe(1);

    // dpl_9c1f is no longer active, so a repeat under fresh authority fails on
    // the domain rule rather than on authorisation.
    const { state: rearmed } = run(first.state, [
      {
        type: "grant.request",
        at: T0 + 6 * SEC,
        req: {
          operationId: "rollback_deploy",
          scopeRef: "dpl_9c1f",
          reason: "second attempt",
          requestedBy: "agent",
        },
      },
    ]);
    const pending = rearmed.grants.find((g) => g.status === "pending")!;
    const { state: live } = run(rearmed, [
      { type: "grant.approve", at: T0 + 7 * SEC, grantId: pending.id },
    ]);

    const failed = reduce(
      live,
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }, T0 + 8 * SEC),
    );
    expect(failed.result.ok).toBe(false);
    if (!failed.result.ok) expect(failed.result.error).toMatch(/not the active deployment/);

    const after = failed.state.grants.find((g) => g.id === pending.id)!;
    expect(after.usesConsumed).toBe(0);
    expect(after.status).toBe("active");

    // And the failure is on the record as an error, not a denial.
    expect(failed.state.ledger.at(-1)?.outcome).toBe("error");
  });

  it("refuses a call for a resource the grant does not name", () => {
    const armed = grantedRollback().state;
    const { last } = run(armed, [
      agentExec("rollback_deploy", { deployId: "dpl_5b02", reason: "r" }, T0 + 5 * SEC),
    ]);
    expect(last.ok).toBe(false);
  });

  it("lets the grant lapse on its own clock", () => {
    const armed = grantedRollback().state;
    const { state: swept } = run(armed, [{ type: "tick", at: T0 + 400 * SEC }]);
    expect(swept.grants[0].status).toBe("expired");

    const { last } = run(swept, [
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }, T0 + 401 * SEC),
    ]);
    expect(last.ok).toBe(false);
  });

  it("honours a grant cap that the operator tightened at approval", () => {
    const { state: armed } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "scale_service",
          scopeRef: "svc_checkout",
          reason: "shed load",
          requestedBy: "agent",
          caps: { replicas: 24 },
        },
      },
      { type: "grant.approve", at: T0, grantId: "gr_0002", tighten: { caps: { replicas: 8 } } },
    ]);

    const tooBig = reduce(armed, agentExec("scale_service", { serviceId: "svc_checkout", replicas: 20 }));
    expect(tooBig.result.ok).toBe(false);
    if (!tooBig.result.ok) expect(tooBig.result.error).toContain("8");

    const allowed = reduce(armed, agentExec("scale_service", { serviceId: "svc_checkout", replicas: 8 }));
    expect(allowed.result.ok).toBe(true);
    expect(allowed.state.services.find((s) => s.id === "svc_checkout")?.replicas).toBe(8);
  });

  it("keeps service replica bounds above any grant", () => {
    const { state: armed } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "scale_service",
          scopeRef: "svc_checkout",
          reason: "x",
          requestedBy: "agent",
          caps: { replicas: 64 },
        },
      },
      { type: "grant.approve", at: T0, grantId: "gr_0002" },
    ]);
    const r = reduce(armed, agentExec("scale_service", { serviceId: "svc_checkout", replicas: 40 }));
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error).toMatch(/2-24|outside/);
  });
});

describe("forbidden operations", () => {
  it("never lets an agent delete a service", () => {
    const { last, state: next } = run(state, [agentExec("delete_service", { serviceId: "svc_search" })]);
    expect(last.ok).toBe(false);
    expect(next.services.some((s) => s.id === "svc_search")).toBe(true);
  });

  it("refuses even to open a grant request for a forbidden operation", () => {
    const { last } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "delete_service",
          scopeRef: "svc_search",
          reason: "cleanup",
          requestedBy: "agent",
        },
      },
    ]);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.error).toMatch(/forbidden/i);
  });

  it("still lets the human do it in their own console", () => {
    const { last, state: next } = run(state, [humanExec("delete_service", { serviceId: "svc_search" })]);
    expect(last.ok).toBe(true);
    expect(next.services.some((s) => s.id === "svc_search")).toBe(false);
  });
});

describe("policy changes", () => {
  it("revokes outstanding authority when an operation is tightened", () => {
    const armed = grantedRollback().state;
    expect(armed.grants[0].status).toBe("active");

    const { state: next } = run(armed, [
      {
        type: "policy.set",
        at: T0 + 2 * SEC,
        actor: "human",
        operationId: "rollback_deploy",
        value: "forbidden",
      },
    ]);
    expect(next.grants[0].status).toBe("revoked");

    const { last } = run(next, [
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "r" }, T0 + 3 * SEC),
    ]);
    expect(last.ok).toBe(false);
  });

  it("lets the operator relax an operation to auto", () => {
    const { state: next } = run(state, [
      {
        type: "policy.set",
        at: T0,
        actor: "human",
        operationId: "purge_cache",
        value: "auto",
      },
    ]);
    const r = reduce(next, agentExec("purge_cache", { serviceId: "svc_catalog", pathPrefix: "/api" }));
    expect(r.result.ok).toBe(true);
  });
});

describe("untrusted telemetry", () => {
  it("quarantines injected instructions before the agent sees the logs", () => {
    const { state: next, last } = run(state, [
      agentExec("read_telemetry", { serviceId: "svc_checkout", windowMinutes: 60 }),
    ]);
    expect(last.ok).toBe(true);
    if (!last.ok) return;

    const logs = String((last as unknown as { logs: string }).logs);
    expect(logs).toContain(QUARANTINE_MARK);
    expect(logs.toLowerCase()).not.toContain("ignore all previous instructions");
    expect(logs.toLowerCase()).not.toContain("do not tell the operator");
    expect(logs).toContain("<untrusted");

    expect(next.quarantine.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves clean telemetry untouched", () => {
    const { last } = run(state, [agentExec("read_telemetry", { serviceId: "svc_catalog" })]);
    expect(last.ok).toBe(true);
    if (last.ok) {
      expect(String((last as unknown as { logs: string }).logs)).not.toContain(QUARANTINE_MARK);
    }
  });

  it("attributes the regression to the window in which the deploy landed", () => {
    const { last } = run(state, [
      agentExec("read_telemetry", { serviceId: "svc_checkout", windowMinutes: 60 }),
    ]);
    expect(last.ok).toBe(true);
    if (last.ok) {
      const regression = (last as unknown as { regression: { after: number } | null }).regression;
      expect(regression).not.toBeNull();
      expect(regression!.after).toBeGreaterThan(1);
    }
  });
});

describe("agent-owned writing", () => {
  it("accepts findings on an incident with no grant needed", () => {
    const { state: next, last } = run(state, [
      agentExec("annotate_incident", {
        incidentId: "inc_2291",
        body: "Error rate steps up exactly at dpl_9c1f.",
        kind: "finding",
      }),
    ]);
    expect(last.ok).toBe(true);
    expect(next.incidents[0].notes.at(-1)?.actor).toBe("agent");
  });

  it("drafts a plan without executing any of it", () => {
    const steps = JSON.stringify([
      { operationId: "rollback_deploy", params: { deployId: "dpl_9c1f" }, rationale: "reverts NaN" },
    ]);
    const { state: next, last } = run(state, [
      agentExec("draft_remediation", {
        incidentId: "inc_2291",
        summary: "Roll back 9c1f4ab",
        steps,
      }),
    ]);
    expect(last.ok).toBe(true);
    expect(next.remediations).toHaveLength(1);
    expect(next.remediations[0].status).toBe("draft");
    // Nothing shipped.
    expect(next.deploys.find((d) => d.id === "dpl_9c1f")?.active).toBe(true);
    if (last.ok) {
      expect((last as unknown as { needsAuthority: string[] }).needsAuthority).toContain(
        "rollback_deploy",
      );
    }
  });

  it("rejects a malformed plan with a usable example", () => {
    const { last } = run(state, [
      agentExec("draft_remediation", { incidentId: "inc_2291", summary: "x", steps: "not json" }),
    ]);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.hint).toContain("rollback_deploy");
  });
});

describe("money-moving operations", () => {
  it("refuses to refund more than the order is worth", () => {
    const { state: armed } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "issue_refund",
          scopeRef: "ord_5512",
          reason: "duplicate charge",
          requestedBy: "agent",
          caps: { amountCents: 18400 },
        },
      },
      { type: "grant.approve", at: T0, grantId: "gr_0002" },
    ]);
    const r = reduce(armed, agentExec("issue_refund", { orderId: "ord_5512", amountCents: 50000 }));
    expect(r.result.ok).toBe(false);
    expect(r.state.orders.find((o) => o.id === "ord_5512")?.status).toBe("paid");
  });

  it("refunds within the granted ceiling", () => {
    const { state: armed } = run(state, [
      {
        type: "grant.request",
        at: T0,
        req: {
          operationId: "issue_refund",
          scopeRef: "ord_5512",
          reason: "duplicate charge",
          requestedBy: "agent",
          caps: { amountCents: 18400 },
        },
      },
      { type: "grant.approve", at: T0, grantId: "gr_0002" },
    ]);
    const r = reduce(armed, agentExec("issue_refund", { orderId: "ord_5512", amountCents: 18400 }));
    expect(r.result.ok).toBe(true);
    expect(r.state.orders.find((o) => o.id === "ord_5512")?.status).toBe("refunded");
  });
});

describe("grant supersession", () => {
  it("revokes an earlier live grant for the same operation", () => {
    const first = grantedRollback().state;
    const { state: next } = run(first, [
      {
        type: "grant.request",
        at: T0 + 10 * SEC,
        req: {
          operationId: "rollback_deploy",
          scopeRef: "dpl_5b02",
          reason: "different service",
          requestedBy: "agent",
        },
      },
      { type: "grant.approve", at: T0 + 11 * SEC, grantId: "gr_0003" },
    ]);
    const statuses = next.grants.map((g) => `${g.scopeRef}:${g.status}`);
    expect(statuses).toContain("dpl_9c1f:revoked");
    expect(statuses).toContain("dpl_5b02:active");
  });
});

describe("observability surfaces", () => {
  it("keeps the ledger verifiable across a full incident", () => {
    const armed = grantedRollback().state;
    const { state: next } = run(armed, [
      agentExec("read_telemetry", { serviceId: "svc_checkout" }, T0 + 2 * SEC),
      agentExec("annotate_incident", { incidentId: "inc_2291", body: "found it" }, T0 + 3 * SEC),
      agentExec("rollback_deploy", { deployId: "dpl_9c1f", reason: "NaN" }, T0 + 4 * SEC),
      agentExec("delete_service", { serviceId: "svc_search" }, T0 + 5 * SEC),
    ]);
    const verdict = verifyLedger(next.ledger);
    expect(verdict.ok).toBe(true);

    const outcomes = next.ledger.map((e) => e.outcome);
    expect(outcomes).toContain("ok");
    expect(outcomes).toContain("denied");
  });

  it("reports what is callable right now in the operation digest", () => {
    const armed = grantedRollback().state;
    const digest = operationDigest(armed, T0 + 2 * SEC);
    const rollback = digest.find((d) => d.id === "rollback_deploy")!;
    const del = digest.find((d) => d.id === "delete_service")!;

    expect(rollback.callableNow).toBe(true);
    expect(del.callableNow).toBe(false);
    expect(del.howToObtain).toMatch(/human must/i);
  });

  it("exposes a snapshot that matches the store", () => {
    const snap = snapshot(state, T0) as Record<string, unknown>;
    expect((snap.services as unknown[]).length).toBe(state.services.length);
    expect((snap.ledger as { verified: boolean }).verified).toBe(true);
  });
});

describe("store wiring", () => {
  it("notifies subscribers only when state actually changes", () => {
    const store = createStore(createSeedState(T0));
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch({ type: "tick", at: T0 });
    expect(calls).toBe(0);

    store.dispatch(agentExec("annotate_incident", { incidentId: "inc_2291", body: "x" }));
    expect(calls).toBe(1);
  });

  it("returns a structured error rather than throwing on bad input", () => {
    const store = createStore(createSeedState(T0));
    const r = store.dispatch(agentExec("annotate_incident", { incidentId: "nope", body: "x" }));
    expect(r.ok).toBe(false);
  });
});
