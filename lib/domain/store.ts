import {
  activateGrant,
  authorize,
  buildGrant,
  consumeGrant,
  describeGrant,
  liveGrants,
  policyFor,
  sweepGrants,
  type GrantRequest,
  type ParamBag,
} from "./authority";
import { fenceUntrusted, scanUntrusted } from "./injection";
import { appendEntry, verifyLedger } from "./ledger";
import { getOperation, OPERATIONS } from "./operations";
import { createSeedState } from "./seed";
import { attributeRegression, buildSeries, rawLogsFor } from "./telemetry";
import type { Actor, OpResult, LabeState, PolicyClass } from "./types";

/**
 * The single mutation path.
 *
 * A button in the console and a WebMCP `execute` both build an Action and call
 * `reduce`. There is no second code path for agents, which is the only honest
 * way to make "the agent and the human share one system" true rather than
 * decorative. Every Action is authorised, applied, and written to the
 * hash-chained ledger in that order.
 */

export type Action =
  | { type: "tick"; at: number }
  | {
      type: "policy.set";
      at: number;
      actor: Actor;
      operationId: string;
      value: PolicyClass;
    }
  | { type: "grant.request"; at: number; req: GrantRequest }
  | {
      type: "grant.approve";
      at: number;
      grantId: string;
      tighten?: { caps?: Record<string, number>; maxUses?: number; ttlMs?: number };
    }
  | { type: "grant.deny"; at: number; grantId: string; reason?: string }
  | { type: "grant.revoke"; at: number; grantId: string }
  | {
      type: "op.execute";
      at: number;
      actor: Actor;
      operationId: string;
      params: ParamBag;
      /** Tool name, when the call arrived over WebMCP. */
      via?: string;
    }
  /**
   * A host asked for a tool that is not registered.
   *
   * A conforming WebMCP host cannot produce this: an unregistered tool is not
   * in its list, so there is nothing to call. It is reachable from the in-page
   * console, and from any host holding a stale descriptor — both of which are
   * exactly the events an operator wants on the record. "The agent reached for
   * something it did not have" is a signal, not a non-event.
   */
  | { type: "tool.unregistered"; at: number; toolName: string; params: ParamBag }
  | { type: "reset"; at: number };

export interface Reduction {
  state: LabeState;
  result: OpResult;
}

/* --------------------------------- helpers -------------------------------- */

function mkId(state: LabeState, prefix: string): [string, number] {
  const next = state.seq + 1;
  return [`${prefix}_${next.toString(36).padStart(4, "0")}`, next];
}

function log(
  state: LabeState,
  draft: {
    at: number;
    actor: Actor;
    action: string;
    tool?: string;
    outcome: "ok" | "denied" | "error";
    detail?: Record<string, unknown>;
  },
): LabeState {
  return {
    ...state,
    ledger: [
      ...state.ledger,
      appendEntry(state.ledger, {
        ts: draft.at,
        actor: draft.actor,
        action: draft.action,
        tool: draft.tool,
        outcome: draft.outcome,
        detail: draft.detail ?? {},
      }),
    ],
  };
}

/** Expire and exhaust grants, writing one ledger line per transition. */
function sweep(state: LabeState, at: number): LabeState {
  const { grants, changed } = sweepGrants(state.grants, at);
  if (!changed.length) return state;
  let next: LabeState = { ...state, grants };
  for (const g of changed) {
    next = log(next, {
      at,
      actor: "system",
      action: `grant.${g.status}`,
      outcome: "ok",
      detail: {
        grantId: g.id,
        operation: g.operationId,
        scope: g.scopeRef,
        uses: `${g.usesConsumed}/${g.maxUses}`,
      },
    });
  }
  return next;
}

/* -------------------------------- snapshots ------------------------------- */

/**
 * Compact authoritative state for `get_system_state`.
 * Deliberately terse: Chrome's guidance is to keep tool output small, and a
 * model reasons better over a tight object than a dump of the whole store.
 */
export function snapshot(state: LabeState, now: number): Record<string, unknown> {
  const verdict = verifyLedger(state.ledger);
  return {
    now,
    services: state.services.map((s) => ({
      id: s.id,
      name: s.name,
      health: s.health,
      errorRatePct: s.errorRatePct,
      p95Ms: s.p95Ms,
      replicas: s.replicas,
      replicaBounds: [s.minReplicas, s.maxReplicas],
    })),
    // Changed files only for what is live: that is the deploy an agent needs
    // to reason about, and the rest is budget spent on history.
    deploys: state.deploys.map((d) => ({
      id: d.id,
      service: d.serviceId,
      sha: d.sha,
      author: d.author,
      message: d.message,
      minutesAgo: Math.round((now - d.at) / 60000),
      active: d.active,
      ...(d.active ? { changedFiles: d.changedFiles } : {}),
    })),
    // Flags and orders are one-liners: a model parses these as readily as
    // nested objects, at a fraction of the output budget.
    flags: state.flags.map(
      (f) =>
        `${f.id} key=${f.key} ${f.enabled ? "on" : "off"} ${f.rolloutPct}% service=${f.serviceId}`,
    ),
    orders: state.orders.map((o) => `${o.id} ${o.amountCents}c ${o.status}`),
    incidents: state.incidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      service: i.serviceId,
      minutesOpen: Math.round((now - i.openedAt) / 60000),
      notes: i.notes.slice(-3).map((n) => `${n.actor}/${n.kind}: ${n.body}`),
    })),
    remediations: state.remediations.map((r) => ({
      id: r.id,
      incidentId: r.incidentId,
      summary: r.summary,
      status: r.status,
      steps: r.steps.map((s) => s.operationId),
    })),
    authority: {
      live: liveGrants(state.grants, now).map((g) => describeGrant(g, now)),
      pending: state.grants
        .filter((g) => g.status === "pending")
        .map((g) => ({ id: g.id, operation: g.operationId, scope: g.scopeRef })),
    },
    // Grouped by class rather than one line per operation.
    policy: {
      auto: OPERATIONS.filter((o) => policyFor(state, o.id) === "auto").map((o) => o.id),
      grant: OPERATIONS.filter((o) => policyFor(state, o.id) === "grant").map((o) => o.id),
      forbidden: OPERATIONS.filter((o) => policyFor(state, o.id) === "forbidden").map(
        (o) => o.id,
      ),
    },
    quarantinedSpans: state.quarantine.length,
    ledger: {
      entries: state.ledger.length,
      verified: verdict.ok,
      head: verdict.ok ? verdict.head.slice(0, 12) : null,
    },
  };
}

/** The operation catalog joined to current policy and current authority. */
export function operationDigest(state: LabeState, now: number) {
  const live = liveGrants(state.grants, now);
  return OPERATIONS.map((op) => {
    const policy = policyFor(state, op.id);
    const held = live.filter((g) => g.operationId === op.id);
    const callableNow = policy === "auto" || held.length > 0;
    return {
      id: op.id,
      risk: op.risk,
      policy,
      callableNow,
      params: op.params.map((p) => `${p.name}:${p.type}${p.required ? "" : "?"}`).join(","),
      // Only spend budget on the fields that change the agent's next move.
      ...(op.risk === "irreversible" ? { blast: op.blastRadius } : {}),
      ...(held.length ? { authorityHeld: held.map((g) => describeGrant(g, now)) } : {}),
      ...(callableNow
        ? {}
        : {
            howToObtain:
              policy === "grant"
                ? `request_authority(operation="${op.id}", scopeRef="<${op.scopeKind} id>", reason="...")`
                : "Not obtainable. A human must do this in the console.",
          }),
    };
  });
}

/* ------------------------------- effects ---------------------------------- */

type Effect =
  | { ok: true; state: LabeState; summary: string; detail: Record<string, unknown> }
  | { ok: false; error: string; hint?: string };

function applyOperation(
  state: LabeState,
  operationId: string,
  p: ParamBag,
  at: number,
  actor: Actor,
): Effect {
  switch (operationId) {
    /* ------------------------------ reads ------------------------------- */
    case "get_system_state": {
      return {
        ok: true,
        state,
        summary: "Returned the authoritative console state.",
        detail: { snapshot: true },
      };
    }

    case "read_telemetry": {
      const serviceId = String(p.serviceId);
      const service = state.services.find((s) => s.id === serviceId);
      if (!service) {
        return {
          ok: false,
          error: `No service "${serviceId}".`,
          hint: "Call get_system_state for valid service ids.",
        };
      }
      const windowMinutes = Math.min(180, Math.max(5, Number(p.windowMinutes ?? 60)));
      const activeDeploy = state.deploys.find(
        (d) => d.serviceId === serviceId && d.active,
      );
      const series = buildSeries(service, activeDeploy, at, windowMinutes);
      const regression = attributeRegression(series);

      const scanned = scanUntrusted(rawLogsFor(serviceId).join("\n"));
      let next = state;
      if (scanned.hits.length) {
        const records = scanned.hits.map((h, i) => ({
          id: `qtn_${at.toString(36)}_${i}`,
          at,
          source: `${serviceId} logs`,
          rule: h.ruleId,
          excerpt: h.excerpt,
        }));
        next = { ...state, quarantine: [...state.quarantine, ...records] };
      }

      return {
        ok: true,
        state: next,
        summary: `Telemetry for ${service.name} over ${windowMinutes}m; ${scanned.hits.length} span(s) quarantined.`,
        detail: {
          service: serviceId,
          windowMinutes,
          errorRatePct: service.errorRatePct,
          p95Ms: service.p95Ms,
          regression,
          quarantined: scanned.hits.map((h) => h.ruleId),
          logs: fenceUntrusted(`${serviceId} logs`, scanned.text, scanned.hits.length),
        },
      };
    }

    /* ------------------------- agent-owned writing ---------------------- */
    case "annotate_incident": {
      const incident = state.incidents.find((i) => i.id === p.incidentId);
      if (!incident) {
        return { ok: false, error: `No incident "${String(p.incidentId)}".` };
      }
      const [id, seq] = mkId(state, "note");
      const kind = (p.kind as "finding" | "action" | "note") ?? "finding";
      const note = { id, at, actor, kind, body: String(p.body) };
      return {
        ok: true,
        state: {
          ...state,
          seq,
          incidents: state.incidents.map((i) =>
            i.id === incident.id ? { ...i, notes: [...i.notes, note] } : i,
          ),
        },
        summary: `Added a ${kind} to ${incident.id}.`,
        detail: { incidentId: incident.id, noteId: id, kind },
      };
    }

    case "draft_remediation": {
      const incident = state.incidents.find((i) => i.id === p.incidentId);
      if (!incident) {
        return { ok: false, error: `No incident "${String(p.incidentId)}".` };
      }
      let steps: { operationId: string; params: ParamBag; rationale: string }[] = [];
      try {
        const parsed = JSON.parse(String(p.steps));
        if (!Array.isArray(parsed)) throw new Error("not an array");
        steps = parsed.map((s: Record<string, unknown>) => ({
          operationId: String(s.operationId ?? ""),
          params: (s.params as ParamBag) ?? {},
          rationale: String(s.rationale ?? ""),
        }));
      } catch {
        return {
          ok: false,
          error: "steps must be a JSON array.",
          hint: 'Example: [{"operationId":"rollback_deploy","params":{"deployId":"dpl_9c1f"},"rationale":"reverts the NaN"}]',
        };
      }
      const unknown = steps.filter((s) => !getOperation(s.operationId));
      if (unknown.length) {
        return {
          ok: false,
          error: `Unknown operations: ${unknown.map((s) => s.operationId).join(", ")}.`,
          hint: "Call list_operations first.",
        };
      }
      const [id, seq] = mkId(state, "rem");
      return {
        ok: true,
        state: {
          ...state,
          seq,
          remediations: [
            ...state.remediations,
            {
              id,
              incidentId: incident.id,
              summary: String(p.summary),
              steps,
              author: actor,
              at,
              status: "draft",
            },
          ],
        },
        summary: `Drafted ${id} with ${steps.length} step(s). Nothing executed.`,
        detail: {
          remediationId: id,
          steps: steps.map((s) => s.operationId),
          needsAuthority: steps
            .filter((s) => policyFor(state, s.operationId) === "grant")
            .map((s) => s.operationId),
        },
      };
    }

    /* ---------------------------- grant-gated --------------------------- */
    case "rollback_deploy": {
      const deployId = String(p.deployId);
      const target = state.deploys.find((d) => d.id === deployId);
      if (!target) return { ok: false, error: `No deployment "${deployId}".` };
      if (!target.active) {
        return {
          ok: false,
          error: `${deployId} is not the active deployment.`,
          hint: "Only the active deployment can be rolled back.",
        };
      }
      const previous = state.deploys
        .filter((d) => d.serviceId === target.serviceId && d.id !== target.id)
        .sort((a, b) => b.at - a.at)[0];
      if (!previous) {
        return { ok: false, error: `No earlier deployment for ${target.serviceId}.` };
      }

      const deploys = state.deploys.map((d) =>
        d.id === target.id
          ? { ...d, active: false }
          : d.id === previous.id
            ? { ...d, active: true }
            : d,
      );
      const services = state.services.map((s) =>
        s.id === target.serviceId
          ? { ...s, health: "healthy" as const, errorRatePct: 0.06, p95Ms: 214 }
          : s,
      );
      const [noteId, seq] = mkId(state, "note");
      const incidents = state.incidents.map((i) =>
        i.serviceId === target.serviceId && i.status === "open"
          ? {
              ...i,
              status: "mitigated" as const,
              notes: [
                ...i.notes,
                {
                  id: noteId,
                  at,
                  actor,
                  kind: "action" as const,
                  body: `Rolled back ${target.sha} to ${previous.sha}. ${String(p.reason ?? "")}`.trim(),
                },
              ],
            }
          : i,
      );

      return {
        ok: true,
        state: { ...state, seq, deploys, services, incidents },
        summary: `Rolled ${target.serviceId} back from ${target.sha} to ${previous.sha}.`,
        detail: {
          service: target.serviceId,
          from: target.sha,
          to: previous.sha,
          reason: String(p.reason ?? ""),
        },
      };
    }

    case "set_feature_flag": {
      const flag = state.flags.find((f) => f.id === p.flagId);
      if (!flag) return { ok: false, error: `No flag "${String(p.flagId)}".` };
      const enabled = Boolean(p.enabled);
      const rolloutPct =
        p.rolloutPct === undefined ? (enabled ? flag.rolloutPct : 0) : Number(p.rolloutPct);
      return {
        ok: true,
        state: {
          ...state,
          flags: state.flags.map((f) =>
            f.id === flag.id ? { ...f, enabled, rolloutPct } : f,
          ),
        },
        summary: `${flag.key} is now ${enabled ? "on" : "off"} at ${rolloutPct}%.`,
        detail: { flagId: flag.id, key: flag.key, enabled, rolloutPct },
      };
    }

    case "scale_service": {
      const service = state.services.find((s) => s.id === p.serviceId);
      if (!service) return { ok: false, error: `No service "${String(p.serviceId)}".` };
      const replicas = Number(p.replicas);
      if (replicas < service.minReplicas || replicas > service.maxReplicas) {
        return {
          ok: false,
          error: `${service.name} accepts ${service.minReplicas}-${service.maxReplicas} replicas; ${replicas} is outside that range.`,
          hint: "This bound is a property of the service and no grant overrides it.",
        };
      }
      return {
        ok: true,
        state: {
          ...state,
          services: state.services.map((s) =>
            s.id === service.id ? { ...s, replicas } : s,
          ),
        },
        summary: `${service.name} scaled ${service.replicas} to ${replicas}.`,
        detail: { serviceId: service.id, from: service.replicas, to: replicas },
      };
    }

    case "purge_cache": {
      const service = state.services.find((s) => s.id === p.serviceId);
      if (!service) return { ok: false, error: `No service "${String(p.serviceId)}".` };
      const pathPrefix = String(p.pathPrefix);
      return {
        ok: true,
        state: {
          ...state,
          services: state.services.map((s) =>
            s.id === service.id
              ? { ...s, p95Ms: Math.round(s.p95Ms * 1.35) }
              : s,
          ),
        },
        summary: `Purged ${pathPrefix} on ${service.name}. Origin load will rise.`,
        detail: { serviceId: service.id, pathPrefix, irreversible: true },
      };
    }

    case "issue_refund": {
      const order = state.orders.find((o) => o.id === p.orderId);
      if (!order) return { ok: false, error: `No order "${String(p.orderId)}".` };
      if (order.status === "refunded") {
        return { ok: false, error: `${order.id} is already refunded.` };
      }
      const amountCents = Number(p.amountCents);
      if (amountCents > order.amountCents) {
        return {
          ok: false,
          error: `${order.id} totals ${order.amountCents} cents; cannot refund ${amountCents}.`,
        };
      }
      return {
        ok: true,
        state: {
          ...state,
          orders: state.orders.map((o) =>
            o.id === order.id ? { ...o, status: "refunded" as const } : o,
          ),
        },
        summary: `Refunded ${amountCents} cents on ${order.id}.`,
        detail: { orderId: order.id, amountCents, irreversible: true },
      };
    }

    /* --------------------------- human-only ----------------------------- */
    case "delete_service": {
      const service = state.services.find((s) => s.id === p.serviceId);
      if (!service) return { ok: false, error: `No service "${String(p.serviceId)}".` };
      return {
        ok: true,
        state: {
          ...state,
          services: state.services.filter((s) => s.id !== service.id),
          deploys: state.deploys.filter((d) => d.serviceId !== service.id),
          flags: state.flags.filter((f) => f.serviceId !== service.id),
        },
        summary: `Deleted ${service.name}.`,
        detail: { serviceId: service.id, irreversible: true },
      };
    }

    case "rotate_credentials": {
      const service = state.services.find((s) => s.id === p.serviceId);
      if (!service) return { ok: false, error: `No service "${String(p.serviceId)}".` };
      return {
        ok: true,
        state,
        summary: `Rotated credentials for ${service.name}.`,
        detail: { serviceId: service.id, irreversible: true },
      };
    }

    default:
      return { ok: false, error: `Operation "${operationId}" has no implementation.` };
  }
}

/* -------------------------------- reducer --------------------------------- */

export function reduce(state: LabeState, action: Action): Reduction {
  switch (action.type) {
    case "tick": {
      return { state: sweep(state, action.at), result: { ok: true } };
    }

    case "reset": {
      return { state: createSeedState(action.at), result: { ok: true } };
    }

    case "tool.unregistered": {
      const op = getOperation(action.toolName);
      const policy = op ? policyFor(state, op.id) : undefined;
      const next = log(state, {
        at: action.at,
        actor: "agent",
        action: "tool.unregistered",
        tool: action.toolName,
        outcome: "denied",
        detail: {
          code: op ? "authority_absent" : "unknown_operation",
          reason: op
            ? `${op.label} is not registered as a tool; policy is "${policy}".`
            : `No tool named "${action.toolName}".`,
          params: action.params,
          ...(policy ? { policy } : {}),
        },
      });
      return {
        state: next,
        result: {
          ok: false,
          error: op
            ? `Tool "${action.toolName}" is not registered. ${
                policy === "forbidden"
                  ? "This operation is forbidden to agents; no grant can register it."
                  : "It needs a human-approved grant first."
              }`
            : `No tool named "${action.toolName}".`,
          hint:
            policy === "grant"
              ? `Call request_authority(operation="${action.toolName}", scopeRef="<resource id>", reason="...") and wait for the operator.`
              : policy === "forbidden"
                ? "Describe what you would do and let the operator act in the console."
                : "Call list_operations to see what exists.",
        },
      };
    }

    case "policy.set": {
      const op = getOperation(action.operationId);
      if (!op) {
        return {
          state,
          result: { ok: false, error: `No operation "${action.operationId}".` },
        };
      }
      const before = policyFor(state, action.operationId);
      let next: LabeState = {
        ...state,
        policy: { ...state.policy, [action.operationId]: action.value },
      };
      // Tightening policy must immediately invalidate outstanding authority.
      if (action.value !== "grant") {
        next = {
          ...next,
          grants: next.grants.map((g) =>
            g.operationId === action.operationId && g.status === "active"
              ? { ...g, status: "revoked" as const, decidedAt: action.at }
              : g,
          ),
        };
      }
      next = log(next, {
        at: action.at,
        actor: action.actor,
        action: "policy.set",
        outcome: "ok",
        detail: { operation: action.operationId, from: before, to: action.value },
      });
      return { state: next, result: { ok: true, operation: action.operationId } };
    }

    case "grant.request": {
      const op = getOperation(action.req.operationId);
      if (!op) {
        return {
          state,
          result: {
            ok: false,
            error: `No operation "${action.req.operationId}".`,
            hint: "Call list_operations first.",
          },
        };
      }
      const policy = policyFor(state, action.req.operationId);
      if (policy === "forbidden") {
        const next = log(state, {
          at: action.at,
          actor: action.req.requestedBy ?? "agent",
          action: "grant.request",
          outcome: "denied",
          detail: {
            operation: op.id,
            scope: action.req.scopeRef,
            why: "policy_forbidden",
          },
        });
        return {
          state: next,
          result: {
            ok: false,
            error: `"${op.label}" is forbidden to agents. No grant can be issued.`,
            hint: "Describe what you would do and let the operator act in the console.",
          },
        };
      }
      if (policy === "auto") {
        return {
          state,
          result: {
            ok: false,
            error: `"${op.label}" needs no grant; call it directly.`,
          },
        };
      }

      const [id, seq] = mkId(state, "gr");
      const grant = buildGrant(id, action.req, action.at);
      let next: LabeState = { ...state, seq, grants: [...state.grants, grant] };
      next = log(next, {
        at: action.at,
        actor: grant.requestedBy,
        action: "grant.request",
        outcome: "ok",
        detail: {
          grantId: id,
          operation: op.id,
          scope: grant.scopeRef,
          reason: grant.reason,
          askedFor: {
            maxUses: grant.maxUses,
            ttlSeconds: Math.round(grant.ttlMs / 1000),
            caps: grant.caps,
          },
        },
      });
      return {
        state: next,
        result: {
          ok: true,
          grantId: id,
          status: "pending",
          message: `Requested authority for ${op.label} on ${grant.scopeRef}. A human must approve it. Poll check_authority with grantId "${id}".`,
        },
      };
    }

    case "grant.approve": {
      const grant = state.grants.find((g) => g.id === action.grantId);
      if (!grant) {
        return { state, result: { ok: false, error: `No grant "${action.grantId}".` } };
      }
      if (grant.status !== "pending") {
        return {
          state,
          result: { ok: false, error: `Grant ${grant.id} is ${grant.status}, not pending.` },
        };
      }
      const active = activateGrant(grant, action.at, action.tighten);

      // At most one live grant per operation.
      //
      // Two live grants for the same operation would mean two tools competing
      // for one tool name, and — worse — an ambiguous audit trail: "which
      // authority did that call spend?" Superseding keeps the tool surface and
      // the ledger unambiguous, which is the entire point of the exercise.
      const superseded = state.grants.filter(
        (g) =>
          g.id !== grant.id &&
          g.status === "active" &&
          g.operationId === grant.operationId,
      );

      let next: LabeState = {
        ...state,
        grants: state.grants.map((g) =>
          g.id === grant.id
            ? active
            : superseded.some((s) => s.id === g.id)
              ? { ...g, status: "revoked" as const, decidedAt: action.at }
              : g,
        ),
      };

      for (const s of superseded) {
        next = log(next, {
          at: action.at,
          actor: "system",
          action: "grant.superseded",
          outcome: "ok",
          detail: { grantId: s.id, replacedBy: active.id, operation: s.operationId },
        });
      }

      next = log(next, {
        at: action.at,
        actor: "human",
        action: "grant.approve",
        outcome: "ok",
        detail: {
          grantId: active.id,
          operation: active.operationId,
          scope: active.scopeRef,
          maxUses: active.maxUses,
          ttlSeconds: Math.round(active.ttlMs / 1000),
          caps: active.caps,
          pinned: active.pinnedParams,
        },
      });
      return { state: next, result: { ok: true, grantId: active.id, status: "active" } };
    }

    case "grant.deny": {
      const grant = state.grants.find((g) => g.id === action.grantId);
      if (!grant) {
        return { state, result: { ok: false, error: `No grant "${action.grantId}".` } };
      }
      let next: LabeState = {
        ...state,
        grants: state.grants.map((g) =>
          g.id === grant.id
            ? {
                ...g,
                status: "denied" as const,
                decidedAt: action.at,
                denyReason: action.reason,
              }
            : g,
        ),
      };
      next = log(next, {
        at: action.at,
        actor: "human",
        action: "grant.deny",
        outcome: "denied",
        detail: {
          grantId: grant.id,
          operation: grant.operationId,
          scope: grant.scopeRef,
          reason: action.reason ?? "",
        },
      });
      return { state: next, result: { ok: true, grantId: grant.id, status: "denied" } };
    }

    case "grant.revoke": {
      const grant = state.grants.find((g) => g.id === action.grantId);
      if (!grant) {
        return { state, result: { ok: false, error: `No grant "${action.grantId}".` } };
      }
      let next: LabeState = {
        ...state,
        grants: state.grants.map((g) =>
          g.id === grant.id ? { ...g, status: "revoked" as const, decidedAt: action.at } : g,
        ),
      };
      next = log(next, {
        at: action.at,
        actor: "human",
        action: "grant.revoke",
        outcome: "ok",
        detail: { grantId: grant.id, operation: grant.operationId, scope: grant.scopeRef },
      });
      return { state: next, result: { ok: true, grantId: grant.id, status: "revoked" } };
    }

    case "op.execute": {
      const swept = sweep(state, action.at);
      const op = getOperation(action.operationId);
      const decision = authorize(
        swept,
        action.operationId,
        action.params,
        action.at,
        action.actor,
      );

      if (!decision.allowed) {
        const next = log(swept, {
          at: action.at,
          actor: action.actor,
          action: `op.${action.operationId}`,
          tool: action.via,
          outcome: "denied",
          detail: {
            code: decision.code,
            reason: decision.reason,
            params: action.params,
            policy: decision.policy,
          },
        });
        return {
          state: next,
          result: { ok: false, error: decision.reason, hint: decision.remedy },
        };
      }

      const effect = applyOperation(
        swept,
        action.operationId,
        action.params,
        action.at,
        action.actor,
      );

      if (!effect.ok) {
        const next = log(swept, {
          at: action.at,
          actor: action.actor,
          action: `op.${action.operationId}`,
          tool: action.via,
          outcome: "error",
          detail: { reason: effect.error, params: action.params },
        });
        return { state: next, result: { ok: false, error: effect.error, hint: effect.hint } };
      }

      let next = effect.state;

      // Burn one use of the covering grant, if the call needed one.
      if (decision.grantId) {
        const before = next.grants.find((g) => g.id === decision.grantId);
        next = {
          ...next,
          grants: next.grants.map((g) =>
            g.id === decision.grantId ? consumeGrant(g) : g,
          ),
        };
        const after = next.grants.find((g) => g.id === decision.grantId);
        if (before && after && after.status === "exhausted") {
          next = log(next, {
            at: action.at,
            actor: "system",
            action: "grant.exhausted",
            outcome: "ok",
            detail: { grantId: after.id, operation: after.operationId },
          });
        }
      }

      next = log(next, {
        at: action.at,
        actor: action.actor,
        action: `op.${action.operationId}`,
        tool: action.via,
        outcome: "ok",
        detail: {
          ...effect.detail,
          risk: op?.risk,
          grantId: decision.grantId ?? null,
          policy: decision.policy,
        },
      });

      return {
        state: next,
        result: {
          ok: true,
          summary: effect.summary,
          ...effect.detail,
        },
      };
    }

    default:
      return { state, result: { ok: false, error: "Unknown action." } };
  }
}

/* --------------------------------- store ---------------------------------- */

export const STORAGE_KEY = "labe.console.v1";

export interface Store {
  getState(): LabeState;
  dispatch(action: Action): OpResult;
  subscribe(fn: (state: LabeState) => void): () => void;
}

export function createStore(initial: LabeState): Store {
  let state = initial;
  const listeners = new Set<(s: LabeState) => void>();

  return {
    getState: () => state,
    dispatch(action) {
      const { state: next, result } = reduce(state, action);
      if (next !== state) {
        state = next;
        listeners.forEach((fn) => fn(state));
      }
      return result;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function loadPersisted(now: number): LabeState {
  if (typeof window === "undefined") return createSeedState(now);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState(now);
    const parsed = JSON.parse(raw) as LabeState;
    if (!Array.isArray(parsed.services) || !Array.isArray(parsed.ledger)) {
      return createSeedState(now);
    }
    return parsed;
  } catch {
    return createSeedState(now);
  }
}

export function persist(state: LabeState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked; the console still works in memory */
  }
}
