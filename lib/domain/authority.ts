import { DEFAULT_POLICY, getOperation } from "./operations";
import type {
  Actor,
  AuthorityGrant,
  Operation,
  LabeState,
  PolicyClass,
} from "./types";

/**
 * The authority engine.
 *
 * LABE treats an agent's capability as a *set of registered tools*, not as a
 * set of runtime permission checks. That means the interesting logic lives
 * here: deciding whether a grant covers a specific call, and when a grant
 * stops covering anything at all. The WebMCP layer is a thin translation of
 * these decisions into `registerTool` / `AbortController`.
 *
 * The runtime check in `authorize` is deliberately kept even though a
 * grant-gated tool is not registered without an active grant. Defence in
 * depth: a tool reference captured before a grant expired must not still work.
 */

export type DenyCode =
  | "unknown_operation"
  | "policy_forbidden"
  | "authority_absent"
  | "scope_mismatch"
  | "pin_violation"
  | "cap_exceeded"
  | "hard_max_exceeded"
  | "missing_param"
  | "bad_param";

export type AuthorityDecision =
  | { allowed: true; policy: PolicyClass; grantId?: string }
  | {
      allowed: false;
      policy: PolicyClass;
      code: DenyCode;
      reason: string;
      /** What the agent should do instead. Surfaced verbatim to the model. */
      remedy?: string;
    };

export const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function policyFor(
  state: Pick<LabeState, "policy">,
  operationId: string,
): PolicyClass {
  return state.policy[operationId] ?? DEFAULT_POLICY[operationId] ?? "forbidden";
}

/* ------------------------------ param checks ----------------------------- */

export type ParamBag = Record<string, string | number | boolean>;

export function validateParams(
  op: Operation,
  params: ParamBag,
):
  | { ok: true; value: ParamBag }
  | { ok: false; code: DenyCode; reason: string } {
  const value: ParamBag = {};

  for (const spec of op.params) {
    const raw = params[spec.name];

    if (raw === undefined || raw === null || raw === "") {
      if (spec.required) {
        return {
          ok: false,
          code: "missing_param",
          reason: `Missing required parameter "${spec.name}".`,
        };
      }
      continue;
    }

    if (spec.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          code: "bad_param",
          reason: `Parameter "${spec.name}" must be a number.`,
        };
      }
      if (spec.hardMax !== undefined && n > spec.hardMax) {
        return {
          ok: false,
          code: "hard_max_exceeded",
          reason: `Parameter "${spec.name}" is ${n}, above the product ceiling of ${spec.hardMax}.`,
        };
      }
      if (n < 0) {
        return {
          ok: false,
          code: "bad_param",
          reason: `Parameter "${spec.name}" must not be negative.`,
        };
      }
      value[spec.name] = n;
      continue;
    }

    if (spec.type === "boolean") {
      const b = typeof raw === "boolean" ? raw : raw === "true";
      value[spec.name] = b;
      continue;
    }

    const s = String(raw);
    if (spec.choices && !spec.choices.includes(s)) {
      return {
        ok: false,
        code: "bad_param",
        reason: `Parameter "${spec.name}" must be one of: ${spec.choices.join(", ")}.`,
      };
    }
    value[spec.name] = s;
  }

  return { ok: true, value };
}

/* -------------------------------- lifecycle ------------------------------ */

/** Has this grant run out of time or uses? Pure; callers pass the clock. */
export function grantIsSpent(grant: AuthorityGrant, now: number): boolean {
  if (grant.status !== "active") return true;
  if (grant.expiresAt !== undefined && now >= grant.expiresAt) return true;
  if (grant.usesConsumed >= grant.maxUses) return true;
  return false;
}

/** Move expired or exhausted grants out of `active`. Idempotent. */
export function sweepGrants(
  grants: AuthorityGrant[],
  now: number,
): { grants: AuthorityGrant[]; changed: AuthorityGrant[] } {
  const changed: AuthorityGrant[] = [];
  const next = grants.map((g) => {
    if (g.status !== "active") return g;
    if (g.expiresAt !== undefined && now >= g.expiresAt) {
      const u = { ...g, status: "expired" as const };
      changed.push(u);
      return u;
    }
    if (g.usesConsumed >= g.maxUses) {
      const u = { ...g, status: "exhausted" as const };
      changed.push(u);
      return u;
    }
    return g;
  });
  return { grants: next, changed };
}

export function liveGrants(grants: AuthorityGrant[], now: number): AuthorityGrant[] {
  return grants.filter((g) => !grantIsSpent(g, now));
}

/**
 * The set of operations that should currently exist as WebMCP tools because a
 * human granted authority for them. This is the single source of truth for the
 * dynamic tool surface.
 */
export function grantedToolSurface(
  state: LabeState,
  now: number,
): AuthorityGrant[] {
  return liveGrants(state.grants, now).filter(
    (g) => policyFor(state, g.operationId) === "grant",
  );
}

/* ------------------------------- the decision ---------------------------- */

export function findCoveringGrant(
  state: LabeState,
  operationId: string,
  scopeRef: string | undefined,
  now: number,
): AuthorityGrant | undefined {
  return liveGrants(state.grants, now).find(
    (g) =>
      g.operationId === operationId &&
      (scopeRef === undefined || g.scopeRef === scopeRef),
  );
}

/**
 * Decide whether `operationId(params)` may proceed for `actor`.
 *
 * Humans acting in the console are not gated by grants; the console *is* their
 * authority. Agents are gated by policy, then by a covering grant, then by
 * that grant's pins and caps.
 */
export function authorize(
  state: LabeState,
  operationId: string,
  params: ParamBag,
  now: number,
  actor: Actor = "agent",
): AuthorityDecision {
  const op = getOperation(operationId);
  const policy = policyFor(state, operationId);

  if (!op) {
    return {
      allowed: false,
      policy,
      code: "unknown_operation",
      reason: `No operation named "${operationId}".`,
      remedy: "Call list_operations to see what exists.",
    };
  }

  const checked = validateParams(op, params);
  if (!checked.ok) {
    return { allowed: false, policy, code: checked.code, reason: checked.reason };
  }

  if (actor === "human" || actor === "system") {
    return { allowed: true, policy };
  }

  if (policy === "forbidden") {
    return {
      allowed: false,
      policy,
      code: "policy_forbidden",
      reason: `"${op.label}" is forbidden to agents by standing policy.`,
      remedy:
        "No grant can authorise this. Tell the operator what you would do and let them act in the console.",
    };
  }

  if (policy === "auto") {
    return { allowed: true, policy };
  }

  const scopeRef =
    op.scopeParam !== undefined ? String(checked.value[op.scopeParam] ?? "") : undefined;

  const grant = findCoveringGrant(state, operationId, scopeRef, now);
  if (!grant) {
    return {
      allowed: false,
      policy,
      code: "authority_absent",
      reason: `No active grant covers ${op.label}${scopeRef ? ` on ${scopeRef}` : ""}.`,
      remedy:
        "Call request_authority with the operation, the resource id and a reason, then wait for the operator to approve it.",
    };
  }

  for (const pinned of op.pinned) {
    const expected = grant.pinnedParams[pinned];
    if (expected === undefined) continue;
    if (String(checked.value[pinned]) !== String(expected)) {
      return {
        allowed: false,
        policy,
        code: "pin_violation",
        reason: `This grant is pinned to ${pinned}=${String(expected)}, but the call used ${String(checked.value[pinned])}.`,
        remedy: "Request a separate grant for the other resource.",
      };
    }
  }

  for (const [name, ceiling] of Object.entries(grant.caps)) {
    const given = checked.value[name];
    if (typeof given !== "number") continue;
    if (given > ceiling) {
      return {
        allowed: false,
        policy,
        code: "cap_exceeded",
        reason: `Grant caps ${name} at ${ceiling}; the call asked for ${given}.`,
        remedy: `Retry at or below ${ceiling}, or request a wider grant and say why.`,
      };
    }
  }

  return { allowed: true, policy, grantId: grant.id };
}

/* ------------------------------- constructors ---------------------------- */

export interface GrantRequest {
  operationId: string;
  scopeRef: string;
  reason: string;
  params?: ParamBag;
  requestedBy?: Actor;
  /** Requested ceilings; the operator may tighten these on approval. */
  caps?: Record<string, number>;
  maxUses?: number;
  ttlMs?: number;
}

export function buildGrant(
  id: string,
  req: GrantRequest,
  now: number,
): AuthorityGrant {
  const op = getOperation(req.operationId);
  const pinnedParams: ParamBag = {};
  if (op) {
    for (const p of op.pinned) {
      if (p === op.scopeParam) pinnedParams[p] = req.scopeRef;
      else if (req.params?.[p] !== undefined) pinnedParams[p] = req.params[p];
    }
  }

  return {
    id,
    operationId: req.operationId,
    scopeRef: req.scopeRef,
    pinnedParams,
    caps: req.caps ?? {},
    maxUses: Math.max(1, req.maxUses ?? 1),
    usesConsumed: 0,
    ttlMs: Math.max(30_000, req.ttlMs ?? DEFAULT_TTL_MS),
    requestedAt: now,
    requestedBy: req.requestedBy ?? "agent",
    reason: req.reason,
    status: "pending",
  };
}

/** Approving starts the TTL clock. A grant is only dangerous once live. */
export function activateGrant(
  grant: AuthorityGrant,
  now: number,
  tighten?: { caps?: Record<string, number>; maxUses?: number; ttlMs?: number },
): AuthorityGrant {
  const ttlMs = tighten?.ttlMs ?? grant.ttlMs;
  return {
    ...grant,
    caps: tighten?.caps ?? grant.caps,
    maxUses: tighten?.maxUses ?? grant.maxUses,
    ttlMs,
    status: "active",
    decidedAt: now,
    activatedAt: now,
    expiresAt: now + ttlMs,
  };
}

export function consumeGrant(grant: AuthorityGrant): AuthorityGrant {
  const usesConsumed = grant.usesConsumed + 1;
  return {
    ...grant,
    usesConsumed,
    status: usesConsumed >= grant.maxUses ? "exhausted" : grant.status,
  };
}

export function describeGrant(grant: AuthorityGrant, now: number): string {
  const op = getOperation(grant.operationId);
  const remaining = grant.expiresAt ? Math.max(0, grant.expiresAt - now) : 0;
  const caps = Object.entries(grant.caps)
    .map(([k, v]) => `${k}<=${v}`)
    .join(", ");
  return [
    op?.label ?? grant.operationId,
    `on ${grant.scopeRef}`,
    `${grant.maxUses - grant.usesConsumed} of ${grant.maxUses} use(s) left`,
    `${Math.ceil(remaining / 1000)}s remaining`,
    caps ? `caps: ${caps}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
