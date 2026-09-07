import { beforeEach, describe, expect, it } from "vitest";
import {
  activateGrant,
  authorize,
  buildGrant,
  consumeGrant,
  grantIsSpent,
  grantedToolSurface,
  sweepGrants,
  validateParams,
} from "./authority";
import { getOperation } from "./operations";
import { createSeedState } from "./seed";
import type { LabeState } from "./types";

const T0 = 1_800_000_000_000;

let state: LabeState;

beforeEach(() => {
  state = createSeedState(T0);
});

/** Approve a grant directly into state, bypassing the reducer. */
function withActiveGrant(
  base: LabeState,
  opts: {
    operationId: string;
    scopeRef: string;
    caps?: Record<string, number>;
    maxUses?: number;
    ttlMs?: number;
    at?: number;
  },
): LabeState {
  const at = opts.at ?? T0;
  const grant = activateGrant(
    buildGrant("gr_test", { ...opts, reason: "test" }, at),
    at,
  );
  return { ...base, grants: [...base.grants, grant] };
}

describe("validateParams", () => {
  const scale = getOperation("scale_service")!;

  it("rejects a missing required parameter", () => {
    const r = validateParams(scale, { serviceId: "svc_checkout" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_param");
  });

  it("coerces numeric strings", () => {
    const r = validateParams(scale, { serviceId: "svc_checkout", replicas: "12" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.replicas).toBe(12);
  });

  it("enforces the product hard ceiling ahead of any grant", () => {
    const r = validateParams(scale, { serviceId: "svc_checkout", replicas: 9999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("hard_max_exceeded");
  });

  it("rejects a value outside a declared choice list", () => {
    const annotate = getOperation("annotate_incident")!;
    const r = validateParams(annotate, {
      incidentId: "inc_2291",
      body: "x",
      kind: "sabotage",
    });
    expect(r.ok).toBe(false);
  });
});

describe("authorize", () => {
  it("allows an auto-class operation with no grant", () => {
    const d = authorize(state, "annotate_incident", { incidentId: "inc_2291", body: "hi" }, T0);
    expect(d.allowed).toBe(true);
  });

  it("refuses a forbidden operation and says no grant can help", () => {
    const d = authorize(state, "delete_service", { serviceId: "svc_checkout" }, T0);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("policy_forbidden");
      expect(d.remedy).toMatch(/operator/i);
    }
  });

  it("refuses a forbidden operation even when a grant somehow exists", () => {
    const armed = withActiveGrant(state, {
      operationId: "delete_service",
      scopeRef: "svc_checkout",
    });
    const d = authorize(armed, "delete_service", { serviceId: "svc_checkout" }, T0);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("policy_forbidden");
  });

  it("refuses a grant-class operation with no authority and explains how to ask", () => {
    const d = authorize(
      state,
      "rollback_deploy",
      { deployId: "dpl_9c1f", reason: "spike" },
      T0,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("authority_absent");
      expect(d.remedy).toMatch(/request_authority/);
    }
  });

  it("allows the exact call a grant covers", () => {
    const armed = withActiveGrant(state, {
      operationId: "rollback_deploy",
      scopeRef: "dpl_9c1f",
    });
    const d = authorize(
      armed,
      "rollback_deploy",
      { deployId: "dpl_9c1f", reason: "spike" },
      T0,
    );
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.grantId).toBe("gr_test");
  });

  it("refuses a different resource than the grant names", () => {
    const armed = withActiveGrant(state, {
      operationId: "rollback_deploy",
      scopeRef: "dpl_9c1f",
    });
    const d = authorize(
      armed,
      "rollback_deploy",
      { deployId: "dpl_7a30", reason: "spike" },
      T0,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("authority_absent");
  });

  it("refuses a numeric argument above the grant cap", () => {
    const armed = withActiveGrant(state, {
      operationId: "scale_service",
      scopeRef: "svc_checkout",
      caps: { replicas: 8 },
    });
    const d = authorize(armed, "scale_service", { serviceId: "svc_checkout", replicas: 24 }, T0);
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.code).toBe("cap_exceeded");
      expect(d.reason).toContain("8");
    }
  });

  it("allows a numeric argument at exactly the cap", () => {
    const armed = withActiveGrant(state, {
      operationId: "scale_service",
      scopeRef: "svc_checkout",
      caps: { replicas: 8 },
    });
    const d = authorize(armed, "scale_service", { serviceId: "svc_checkout", replicas: 8 }, T0);
    expect(d.allowed).toBe(true);
  });

  it("does not gate a human acting in their own console", () => {
    const d = authorize(
      state,
      "delete_service",
      { serviceId: "svc_checkout" },
      T0,
      "human",
    );
    expect(d.allowed).toBe(true);
  });

  it("reports an unknown operation instead of throwing", () => {
    const d = authorize(state, "drop_database", {}, T0);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.code).toBe("unknown_operation");
  });
});

describe("grant lifetime", () => {
  it("stops covering calls once the ttl elapses", () => {
    const armed = withActiveGrant(state, {
      operationId: "rollback_deploy",
      scopeRef: "dpl_9c1f",
      ttlMs: 60_000,
    });
    const later = T0 + 60_001;
    expect(grantIsSpent(armed.grants[0], later)).toBe(true);
    const d = authorize(armed, "rollback_deploy", { deployId: "dpl_9c1f", reason: "x" }, later);
    expect(d.allowed).toBe(false);
  });

  it("is exhausted once its use budget is spent", () => {
    const armed = withActiveGrant(state, {
      operationId: "purge_cache",
      scopeRef: "svc_catalog",
      maxUses: 2,
    });
    let g = armed.grants[0];
    g = consumeGrant(g);
    expect(g.status).toBe("active");
    g = consumeGrant(g);
    expect(g.status).toBe("exhausted");
    expect(grantIsSpent(g, T0)).toBe(true);
  });

  it("sweeps expired grants exactly once", () => {
    const armed = withActiveGrant(state, {
      operationId: "purge_cache",
      scopeRef: "svc_catalog",
      ttlMs: 30_000,
    });
    const first = sweepGrants(armed.grants, T0 + 31_000);
    expect(first.changed).toHaveLength(1);
    expect(first.grants[0].status).toBe("expired");

    const second = sweepGrants(first.grants, T0 + 32_000);
    expect(second.changed).toHaveLength(0);
  });

  it("excludes spent grants from the tool surface", () => {
    const armed = withActiveGrant(state, {
      operationId: "rollback_deploy",
      scopeRef: "dpl_9c1f",
      ttlMs: 60_000,
    });
    expect(grantedToolSurface(armed, T0)).toHaveLength(1);
    expect(grantedToolSurface(armed, T0 + 61_000)).toHaveLength(0);
  });

  it("pins the scope parameter when the grant is built", () => {
    const grant = buildGrant(
      "gr_1",
      { operationId: "rollback_deploy", scopeRef: "dpl_9c1f", reason: "r" },
      T0,
    );
    expect(grant.pinnedParams.deployId).toBe("dpl_9c1f");
    expect(grant.status).toBe("pending");
    expect(grant.expiresAt).toBeUndefined();
  });

  it("starts the clock only on activation", () => {
    const pending = buildGrant(
      "gr_1",
      { operationId: "rollback_deploy", scopeRef: "dpl_9c1f", reason: "r" },
      T0,
    );
    const active = activateGrant(pending, T0 + 10_000);
    expect(active.expiresAt).toBe(T0 + 10_000 + active.ttlMs);
  });

  it("lets the operator tighten a request on approval", () => {
    const pending = buildGrant(
      "gr_1",
      {
        operationId: "scale_service",
        scopeRef: "svc_checkout",
        reason: "r",
        caps: { replicas: 24 },
        maxUses: 5,
      },
      T0,
    );
    const active = activateGrant(pending, T0, { caps: { replicas: 8 }, maxUses: 1 });
    expect(active.caps.replicas).toBe(8);
    expect(active.maxUses).toBe(1);
  });
});
