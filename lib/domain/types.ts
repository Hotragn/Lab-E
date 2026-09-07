/**
 * LABE domain types.
 *
 * One rule governs this file: the DOM is a view, never the source of truth.
 * A human click and a WebMCP `execute` both produce an Action and go through
 * the same reducer, so what the UI shows is the real state.
 */

export type Actor = "human" | "agent" | "system";

/** How much damage an operation can do if the caller is wrong or hostile. */
export type RiskClass = "read" | "mutate" | "irreversible";

/**
 * The standing policy class for an operation. This is the crux of LABE:
 *  - auto      : registered permanently; the agent may call it whenever.
 *  - grant     : NOT registered. Becomes a callable tool only while a human
 *                -issued grant is active, then unregisters itself.
 *  - forbidden : never registered under any grant. Human-only, in the UI.
 */
export type PolicyClass = "auto" | "grant" | "forbidden";

export type ParamType = "string" | "number" | "boolean";

export interface OperationParam {
  name: string;
  type: ParamType;
  description: string;
  required: boolean;
  choices?: string[];
  /** Absolute product ceiling, independent of any grant. */
  hardMax?: number;
}

export interface Operation {
  id: string;
  label: string;
  risk: RiskClass;
  /** The resource class a grant must name. Prevents grant-scope smearing. */
  scopeKind: "service" | "deploy" | "flag" | "order" | "none";
  /** Which param carries the resource id a grant is scoped to. */
  scopeParam?: string;
  /** Operator-facing one-liner. */
  summary: string;
  /** Model-facing description. Kept under 500 chars per Chrome guidance. */
  agentDescription: string;
  params: OperationParam[];
  /** Params a grant pins to a constant; the agent cannot vary these. */
  pinned: string[];
  reversible: boolean;
  /** Plain-language consequence, shown on the approval card. */
  blastRadius: string;
}

/* ------------------------------- resources ------------------------------- */

export type Health = "healthy" | "degraded" | "down";

export interface Service {
  id: string;
  name: string;
  region: string;
  replicas: number;
  minReplicas: number;
  maxReplicas: number;
  health: Health;
  errorRatePct: number;
  p95Ms: number;
}

export interface Deploy {
  id: string;
  serviceId: string;
  sha: string;
  author: string;
  message: string;
  at: number;
  active: boolean;
  changedFiles: string[];
}

export interface FeatureFlag {
  id: string;
  key: string;
  serviceId: string;
  enabled: boolean;
  rolloutPct: number;
}

export interface Order {
  id: string;
  customer: string;
  amountCents: number;
  status: "paid" | "refunded" | "disputed";
}

/* ------------------------------- incidents ------------------------------- */

export type Severity = "sev1" | "sev2" | "sev3";

export interface IncidentNote {
  id: string;
  at: number;
  actor: Actor;
  kind: "finding" | "action" | "note";
  body: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: "open" | "mitigated" | "closed";
  serviceId: string;
  openedAt: number;
  notes: IncidentNote[];
}

export interface RemediationStep {
  operationId: string;
  params: Record<string, string | number | boolean>;
  rationale: string;
}

export interface Remediation {
  id: string;
  incidentId: string;
  summary: string;
  steps: RemediationStep[];
  author: Actor;
  at: number;
  status: "draft" | "executed" | "discarded";
}

/* ------------------------------- authority ------------------------------- */

export type GrantStatus =
  | "pending"
  | "active"
  | "denied"
  | "expired"
  | "exhausted"
  | "revoked";

/**
 * A grant is a capability: one operation, one resource, pinned parameters,
 * numeric ceilings, a use budget, and a wall-clock expiry. While it is
 * `active` the matching WebMCP tool exists. Otherwise it does not.
 */
export interface AuthorityGrant {
  id: string;
  operationId: string;
  /** The single resource this grant covers, e.g. "svc_checkout". */
  scopeRef: string;
  pinnedParams: Record<string, string | number | boolean>;
  /** Numeric parameter ceilings, e.g. { replicas: 8 }. */
  caps: Record<string, number>;
  maxUses: number;
  usesConsumed: number;
  ttlMs: number;
  requestedAt: number;
  requestedBy: Actor;
  reason: string;
  status: GrantStatus;
  decidedAt?: number;
  activatedAt?: number;
  expiresAt?: number;
  denyReason?: string;
}

/* --------------------------------- ledger -------------------------------- */

export type Outcome = "ok" | "denied" | "error";

export interface LedgerEntry {
  seq: number;
  ts: number;
  actor: Actor;
  action: string;
  tool?: string;
  outcome: Outcome;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/* ------------------------------- quarantine ------------------------------ */

export interface QuarantineRecord {
  id: string;
  at: number;
  source: string;
  rule: string;
  excerpt: string;
}

/* --------------------------------- state --------------------------------- */

export interface LabeState {
  services: Service[];
  deploys: Deploy[];
  flags: FeatureFlag[];
  orders: Order[];
  incidents: Incident[];
  remediations: Remediation[];
  grants: AuthorityGrant[];
  policy: Record<string, PolicyClass>;
  ledger: LedgerEntry[];
  quarantine: QuarantineRecord[];
  seq: number;
}

/** Result envelope shared by UI handlers and WebMCP tool executions. */
export type OpResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; hint?: string };
