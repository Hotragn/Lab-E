import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOperation } from "@/lib/domain/operations";
import { createSeedState } from "@/lib/domain/seed";
import { createStore, type Action, type Store } from "@/lib/domain/store";
import { BASE_TOOL_NAMES, LabeBridge, schemaFor } from "./bridge";
import type { RegisterToolOptions, WebMCPToolDescriptor } from "./types";

/**
 * These tests are the thesis of the project.
 *
 * A grant-gated operation must not merely be refused at execute time — it must
 * not exist as a registered tool at all, and it must leave the surface the
 * moment its authority ends.
 */

const T0 = 1_800_000_000_000;
const SEC = 1000;

interface Recorded {
  descriptor: WebMCPToolDescriptor;
  options?: RegisterToolOptions;
  aborted: boolean;
}

let recorded: Recorded[] = [];
let store: Store;
let bridge: LabeBridge;
let clock = T0;
let surfaceSnapshots: string[][] = [];

function installFakeModelContext() {
  const modelContext = {
    registerTool(descriptor: WebMCPToolDescriptor, options?: RegisterToolOptions) {
      const entry: Recorded = { descriptor, options, aborted: false };
      recorded.push(entry);
      options?.signal?.addEventListener("abort", () => {
        entry.aborted = true;
      });
      return Promise.resolve();
    },
  };
  (globalThis as unknown as { document: unknown }).document = { modelContext };
}

const dispatch = (a: Action) => store.dispatch(a);

beforeEach(async () => {
  recorded = [];
  surfaceSnapshots = [];
  clock = T0;
  installFakeModelContext();

  store = createStore(createSeedState(T0));
  bridge = new LabeBridge({
    getState: () => store.getState(),
    dispatch,
    now: () => clock,
    onChange: (tools) => surfaceSnapshots.push(tools.map((t) => t.name)),
  });
  store.subscribe(() => bridge.sync());
  await bridge.start();
});

afterEach(() => {
  bridge.stop();
  delete (globalThis as unknown as { document?: unknown }).document;
});

const names = () => bridge.registeredTools().map((t) => t.name);
const recordFor = (name: string) =>
  recorded.filter((r) => r.descriptor.name === name).at(-1);

/** Ask for and receive authority over dpl_9c1f. */
function approveRollback(opts: { ttlMs?: number; maxUses?: number } = {}) {
  dispatch({
    type: "grant.request",
    at: clock,
    req: {
      operationId: "rollback_deploy",
      scopeRef: "dpl_9c1f",
      reason: "cart totals regressed",
      requestedBy: "agent",
      ttlMs: opts.ttlMs ?? 300 * SEC,
      maxUses: opts.maxUses ?? 1,
    },
  });
  const pending = store.getState().grants.find((g) => g.status === "pending")!;
  dispatch({ type: "grant.approve", at: clock, grantId: pending.id });
  bridge.sync();
  return pending.id;
}

describe("bridge startup", () => {
  it("finds modelContext on document", () => {
    expect(bridge.status().surface).toBe("document");
    expect(bridge.status().live).toBe(true);
  });

  it("registers exactly the base tool set", () => {
    expect(names().sort()).toEqual([...BASE_TOOL_NAMES].sort());
  });

  it("registers every base tool with the real API", () => {
    for (const name of BASE_TOOL_NAMES) {
      expect(recordFor(name), `${name} was not registered`).toBeDefined();
    }
  });

  it("gives every tool an AbortSignal so it can be withdrawn", () => {
    for (const r of recorded) {
      expect(r.options?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("keeps every tool same-origin by default", () => {
    for (const r of recorded) {
      expect(r.options?.exposedTo).toBeUndefined();
    }
  });

  it("keeps descriptions inside the 500-character budget", () => {
    for (const r of recorded) {
      expect(
        r.descriptor.description.length,
        `${r.descriptor.name} description too long`,
      ).toBeLessThanOrEqual(500);
    }
  });

  it("keeps tool names inside the 30-character budget", () => {
    for (const r of recorded) {
      expect(r.descriptor.name.length).toBeLessThanOrEqual(30);
    }
  });

  it("marks read-only tools so the agent can skip confirmations", () => {
    expect(recordFor("get_system_state")?.descriptor.annotations?.readOnlyHint).toBe(true);
    expect(recordFor("list_operations")?.descriptor.annotations?.readOnlyHint).toBe(true);
    expect(recordFor("verify_ledger")?.descriptor.annotations?.readOnlyHint).toBe(true);
  });

  it("marks telemetry output as untrusted content", () => {
    const telemetry = recordFor("read_telemetry")!;
    expect(telemetry.descriptor.annotations?.untrustedContentHint).toBe(true);
  });
});

describe("the grant-gated surface", () => {
  it("does not register any irreversible operation up front", () => {
    for (const id of [
      "rollback_deploy",
      "set_feature_flag",
      "scale_service",
      "purge_cache",
      "issue_refund",
      "delete_service",
      "rotate_credentials",
    ]) {
      expect(names()).not.toContain(id);
    }
  });

  it("tells an agent how to obtain a tool that does not exist", async () => {
    const out = await bridge.invoke("rollback_deploy", { deployId: "dpl_9c1f" });
    expect(out.ok).toBe(false);
    expect(out.text).toMatch(/not registered/i);
    expect(out.text).toMatch(/grant/i);
  });

  it("records the reach for an unregistered tool in the ledger", async () => {
    const before = store.getState().ledger.length;
    await bridge.invoke("rollback_deploy", { deployId: "dpl_9c1f" });

    const entry = store.getState().ledger.at(-1)!;
    expect(store.getState().ledger.length).toBe(before + 1);
    expect(entry.action).toBe("tool.unregistered");
    expect(entry.actor).toBe("agent");
    expect(entry.outcome).toBe("denied");
    expect(entry.tool).toBe("rollback_deploy");
    expect(entry.detail.code).toBe("authority_absent");
    expect(entry.detail.policy).toBe("grant");
  });

  it("distinguishes a forbidden operation from one that needs a grant", async () => {
    const out = await bridge.invoke("delete_service", { serviceId: "svc_search" });
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/forbidden/i);
    expect(parsed.hint).toMatch(/operator/i);
    expect(store.getState().ledger.at(-1)?.detail.policy).toBe("forbidden");
  });

  it("reports an entirely unknown tool name without inventing a policy", async () => {
    const out = await bridge.invoke("drop_database", {});
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(false);
    expect(store.getState().ledger.at(-1)?.detail.code).toBe("unknown_operation");
  });

  it("registers the tool the moment a human approves authority", () => {
    expect(names()).not.toContain("rollback_deploy");
    approveRollback();
    expect(names()).toContain("rollback_deploy");
  });

  it("pins the granted resource into the JSON Schema as a const", () => {
    approveRollback();
    const schema = recordFor("rollback_deploy")!.descriptor.inputSchema;
    expect(schema.properties.deployId.const).toBe("dpl_9c1f");
    expect(schema.properties.deployId.enum).toEqual(["dpl_9c1f"]);
    expect(schema.properties.reason.const).toBeUndefined();
  });

  it("names the grant and its expiry in the tool description", () => {
    const grantId = approveRollback();
    const description = recordFor("rollback_deploy")!.descriptor.description;
    expect(description).toContain(grantId);
    expect(description).toContain("dpl_9c1f");
    expect(description.length).toBeLessThanOrEqual(500);
  });

  it("does not mark a granted tool as read-only", () => {
    approveRollback();
    expect(recordFor("rollback_deploy")?.descriptor.annotations?.readOnlyHint).toBe(false);
  });

  it("never offers a granted tool cross-origin", () => {
    // The same-origin assertion at startup only sees base tools. Granted
    // tools are the irreversible ones, so this is the case that matters:
    // even were READ_ONLY_EXPOSED_TO populated, the forwarding condition
    // requires readOnlyHint, which a granted tool never carries.
    approveRollback();
    const record = recordFor("rollback_deploy")!;
    expect(record.options?.exposedTo).toBeUndefined();
    expect(record.descriptor.annotations?.readOnlyHint).toBe(false);
  });

  it("withdraws the tool once its single use is spent", async () => {
    approveRollback({ maxUses: 1 });
    expect(names()).toContain("rollback_deploy");

    const out = await bridge.invoke("rollback_deploy", {
      deployId: "dpl_9c1f",
      reason: "NaN in cart totals",
    });
    expect(out.ok).toBe(true);

    bridge.sync();
    expect(names()).not.toContain("rollback_deploy");
    expect(recordFor("rollback_deploy")?.aborted).toBe(true);
  });

  it("withdraws the tool when the clock runs out, with no call at all", () => {
    approveRollback({ ttlMs: 60 * SEC });
    expect(names()).toContain("rollback_deploy");

    clock = T0 + 61 * SEC;
    dispatch({ type: "tick", at: clock });
    bridge.sync();

    expect(names()).not.toContain("rollback_deploy");
    expect(recordFor("rollback_deploy")?.aborted).toBe(true);
  });

  it("withdraws the tool when the operator revokes authority", () => {
    const grantId = approveRollback();
    dispatch({ type: "grant.revoke", at: clock, grantId });
    bridge.sync();
    expect(names()).not.toContain("rollback_deploy");
  });

  it("withdraws the tool when the operator tightens policy", () => {
    approveRollback();
    dispatch({
      type: "policy.set",
      at: clock,
      actor: "human",
      operationId: "rollback_deploy",
      value: "forbidden",
    });
    bridge.sync();
    expect(names()).not.toContain("rollback_deploy");
  });

  it("re-registers cleanly after a second grant", () => {
    approveRollback({ maxUses: 1 });
    dispatch({
      type: "op.execute",
      at: clock,
      actor: "agent",
      operationId: "rollback_deploy",
      params: { deployId: "dpl_9c1f", reason: "r" },
    });
    bridge.sync();
    expect(names()).not.toContain("rollback_deploy");

    // The rollback flipped dpl_7a30 active; take authority over that one.
    dispatch({
      type: "grant.request",
      at: clock,
      req: {
        operationId: "rollback_deploy",
        scopeRef: "dpl_7a30",
        reason: "second look",
        requestedBy: "agent",
      },
    });
    const pending = store.getState().grants.find((g) => g.status === "pending")!;
    dispatch({ type: "grant.approve", at: clock, grantId: pending.id });
    bridge.sync();

    expect(names()).toContain("rollback_deploy");
    const schema = recordFor("rollback_deploy")!.descriptor.inputSchema;
    expect(schema.properties.deployId.const).toBe("dpl_7a30");
  });

  it("emits a surface change the UI can render", () => {
    const before = surfaceSnapshots.length;
    approveRollback();
    expect(surfaceSnapshots.length).toBeGreaterThan(before);
    expect(surfaceSnapshots.at(-1)).toContain("rollback_deploy");
  });
});

describe("tool execution", () => {
  it("answers get_system_state from the store, not the DOM", async () => {
    const out = await bridge.invoke("get_system_state", {});
    const parsed = JSON.parse(out.text);
    expect(parsed.services).toHaveLength(4);
    expect(parsed.ledger.verified).toBe(true);
  });

  it("reports what is callable now through list_operations", async () => {
    const out = await bridge.invoke("list_operations", {});
    const parsed = JSON.parse(out.text);
    const rollback = parsed.operations.find(
      (o: { id: string }) => o.id === "rollback_deploy",
    );
    expect(rollback.callableNow).toBe(false);
    expect(rollback.howToObtain).toContain("request_authority");
    expect(parsed.registeredNow).not.toContain("rollback_deploy");
  });

  it("creates a pending grant through request_authority without acting", async () => {
    const out = await bridge.invoke("request_authority", {
      operation: "rollback_deploy",
      scopeRef: "dpl_9c1f",
      reason: "regression at 9c1f4ab",
    });
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("pending");
    expect(names()).not.toContain("rollback_deploy");
  });

  it("refuses a grant request for a forbidden operation", async () => {
    const out = await bridge.invoke("request_authority", {
      operation: "delete_service",
      scopeRef: "svc_search",
      reason: "tidy up",
    });
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/forbidden/i);
  });

  it("rejects malformed caps with a usable hint", async () => {
    const out = await bridge.invoke("request_authority", {
      operation: "scale_service",
      scopeRef: "svc_checkout",
      reason: "load",
      capsJson: "{oops",
    });
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.hint).toContain("replicas");
  });

  it("lets the agent follow a grant to completion via check_authority", async () => {
    const grantId = approveRollback();
    const out = await bridge.invoke("check_authority", { grantId });
    const parsed = JSON.parse(out.text);
    expect(parsed.status).toBe("active");
    expect(parsed.toolRegistered).toBe(true);
    expect(parsed.usesLeft).toBe(1);
  });

  it("quarantines injected log spans on the way out of read_telemetry", async () => {
    const out = await bridge.invoke("read_telemetry", {
      serviceId: "svc_checkout",
      windowMinutes: 60,
    });
    expect(out.text.toLowerCase()).not.toContain("ignore all previous instructions");
    expect(out.text).toContain("labe:quarantined");
  });

  it("proves the chain through verify_ledger", async () => {
    await bridge.invoke("annotate_incident", { incidentId: "inc_2291", body: "note" });
    const out = await bridge.invoke("verify_ledger", { limit: 5 });
    const parsed = JSON.parse(out.text);
    expect(parsed.chain.intact).toBe(true);
    expect(parsed.recent.length).toBeGreaterThan(0);
  });

  it("returns a structured refusal rather than throwing on a bad id", async () => {
    const out = await bridge.invoke("read_telemetry", { serviceId: "svc_nope" });
    const parsed = JSON.parse(out.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.hint).toContain("get_system_state");
  });

  it("keeps output inside the size budget", async () => {
    const out = await bridge.invoke("get_system_state", {});
    expect(out.text.length).toBeLessThanOrEqual(3100);
  });
});

describe("schemaFor", () => {
  it("turns a grant cap into a schema maximum", () => {
    const scale = getOperation("scale_service")!;
    const schema = schemaFor(scale, {
      id: "gr_x",
      operationId: "scale_service",
      scopeRef: "svc_checkout",
      pinnedParams: { serviceId: "svc_checkout" },
      caps: { replicas: 8 },
      maxUses: 1,
      usesConsumed: 0,
      ttlMs: 60_000,
      requestedAt: T0,
      requestedBy: "agent",
      reason: "r",
      status: "active",
    });
    expect(schema.properties.replicas.maximum).toBe(8);
    expect(schema.properties.serviceId.const).toBe("svc_checkout");
  });

  it("never lets a grant cap exceed the product hard ceiling", () => {
    const scale = getOperation("scale_service")!;
    const schema = schemaFor(scale, {
      id: "gr_x",
      operationId: "scale_service",
      scopeRef: "svc_checkout",
      pinnedParams: {},
      caps: { replicas: 9999 },
      maxUses: 1,
      usesConsumed: 0,
      ttlMs: 60_000,
      requestedAt: T0,
      requestedBy: "agent",
      reason: "r",
      status: "active",
    });
    expect(schema.properties.replicas.maximum).toBe(64);
  });

  it("declares required parameters and forbids extras", () => {
    const schema = schemaFor(getOperation("rollback_deploy")!);
    expect(schema.required).toEqual(["deployId", "reason"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
