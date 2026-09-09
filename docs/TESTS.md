# Tests

```bash
npm test          # 137 tests, 6 files
npm run typecheck # tsc --noEmit, strict
npm run build     # production build
```

Node environment, no DOM, no mocks, no fake timers. Every reducer takes `now`
explicitly, which is what makes expiry behaviour testable at all.

| File | Tests | Proves |
|---|---:|---|
| [`lib/domain/sha256.test.ts`](../lib/domain/sha256.test.ts) | 5 | The hash is really SHA-256 |
| [`lib/domain/ledger.test.ts`](../lib/domain/ledger.test.ts) | 9 | Tampering is detectable, and where |
| [`lib/domain/injection.test.ts`](../lib/domain/injection.test.ts) | 33 | Each quarantine rule fires — and does not over-fire |
| [`lib/domain/authority.test.ts`](../lib/domain/authority.test.ts) | 21 | The authorisation decision matrix |
| [`lib/domain/store.test.ts`](../lib/domain/store.test.ts) | 31 | End-to-end incident flows |
| [`lib/webmcp/bridge.test.ts`](../lib/webmcp/bridge.test.ts) | 38 | **The thesis: tools appear and vanish** |

---

## The tests that carry the argument

If you read five, read these.

**Irreversible tools are absent on startup.**
`bridge.test.ts` → *"does not register any irreversible operation up front"*.
Asserts that none of the seven `grant`/`forbidden` operations appear in the
registered surface after `start()`.

**A tool materialises on approval, with the resource pinned into its schema.**
→ *"pins the granted resource into the JSON Schema as a const"*. After approval,
`inputSchema.properties.deployId.const === "dpl_9c1f"` — and `reason` has no
`const`, so the agent still supplies its own reasoning.

**A tool is withdrawn four different ways, with the controller actually aborted.**
→ *"withdraws the tool once its single use is spent"*, *"...when the clock runs
out, with no call at all"*, *"...when the operator revokes authority"*,
*"...when the operator tightens policy"*. Each asserts both that the name has
left the surface **and** that the recorded `AbortSignal` fired.

**A grant cannot be widened, only narrowed.**
`store.test.ts` → *"keeps service replica bounds above any grant"*. A grant
capped at 64 replicas still cannot scale `svc_checkout` past its own maximum of
24.

**Tampering with history is caught at the right entry.**
`ledger.test.ts` → *"detects an edited payload at the entry that was edited"*,
plus a deleted entry (`sequence`) and a correctly re-signed entry whose link no
longer matches (`link`).

---

## Coverage by concern

### SHA-256 · 5 tests

Empty string, `"abc"`, the 448-bit multi-block padding boundary, and the
one-million-character vector — all four published FIPS 180-4 values — plus
determinism and one-bit avalanche. If the ledger's tamper detection is worth
anything, this is why.

### Ledger · 9 tests

Genesis linkage, verification of an intact 12-entry chain, an empty ledger, and
four distinct tamper shapes: edited payload, silently rewritten `actor`, deleted
entry, and a re-signed entry. Plus `stableStringify` key-order independence,
without which two identical details could hash differently.

### Authority · 21 tests

*Parameter validation* — missing required, numeric coercion from strings, hard
ceiling, choice-list violation.

*The decision* — `auto` allowed without a grant; `forbidden` refused **even when
a grant exists**; `grant` with no authority refused and the remedy names
`request_authority`; the exact covered call allowed; a different resource
refused; over-cap refused; exactly-at-cap allowed; a human not gated at all; an
unknown operation reported rather than thrown.

*Lifetime* — TTL lapse, use-budget exhaustion, sweep idempotency (a second sweep
reports no changes), tool-surface exclusion of spent grants, scope pinning at
build time, the clock starting on activation rather than request, and the
operator tightening caps and uses at approval.

### Store · 31 tests

*The gate* — an agent rollback refused with no authority and the deployment left
untouched; the refusal written to the ledger with `code=authority_absent`; a
pending grant authorising nothing; the rollback landing after approval **and the
service actually healing** (`health: healthy`, 5xx under 1%, incident
`mitigated`); the grant spent so a second call fails; a resource outside the
grant refused; expiry via `tick`; a tightened cap enforced; service bounds above
any grant; and **a failed operation leaving the grant unspent** — authority is
spent on work done, not on attempts.

*Forbidden* — an agent cannot delete a service, cannot even open a grant request
for it, and the human still can in their own console.

*Policy* — tightening an operation revokes live authority for it; relaxing to
`auto` makes it callable immediately.

*Untrusted telemetry* — injected spans quarantined, the phrases `"ignore all
previous instructions"` and `"do not tell the operator"` absent from the
returned payload, the `<untrusted>` fence present, clean telemetry left
untouched, and the regression correctly attributed to the deploy window.

*Agent writing* — findings accepted without a grant; a plan drafted **without
executing any of it** (the deploy is still active afterwards) and reporting which
steps need authority; a malformed plan rejected with a usable example.

*Money* — a refund above the order total refused with the order still `paid`; a
refund within the ceiling succeeding.

*Supersession* — approving a second grant for the same operation revokes the
first.

*Observability* — the ledger still verifies after a full incident containing both
successes and denials; `operationDigest` reports what is callable right now;
`snapshot` matches the store.

*Wiring* — subscribers fire only on real change; bad input returns a structured
error rather than throwing.

### Bridge · 38 tests

*Startup* — `document.modelContext` found; exactly the eight base tools
registered; every one registered with the real API; every one given an
`AbortSignal`; **`exposedTo` undefined by default**; `readOnlyHint` on the
read-only tools; `untrustedContentHint` on `read_telemetry`.

*Chrome's budgets, asserted* — every description ≤500 characters, every name
≤30, and `get_system_state` output inside the size ceiling. These are the limits
Chrome publishes; they are cheap to regress and cheap to test.

*The grant-gated surface* — the seven absent operations; a helpful refusal
naming `grant` for an unregistered tool; the reach itself recorded as
`tool.unregistered` with the right denial code, distinguishing `forbidden` from
`grant` from an unknown tool name entirely; registration on approval; `const`
pinning; the grant id and expiry in the description while staying under 500
characters; a granted tool not marked read-only; withdrawal on exhaustion,
expiry, revocation and policy change; clean re-registration under a second grant
with the new resource pinned; and a surface-change event the UI can render.

*Execution* — `get_system_state` answered from the store rather than the DOM;
`list_operations` reporting `callableNow: false` with a `howToObtain` string;
`request_authority` creating a pending grant **without registering anything**;
a forbidden operation refused even as a request; malformed `capsJson` rejected
with a hint; `check_authority` reporting `active`/`toolRegistered`/`usesLeft`;
injection quarantine on the way out; `verify_ledger` proving the chain; a
structured refusal for a bad service id.

*`schemaFor`* — grant caps become `maximum`; a cap above the product ceiling is
clamped to the ceiling; required parameters declared and
`additionalProperties: false`.

---

## Manual test matrix

Automated tests cannot cover a real agent host. These were run by hand.

| Scenario | Environment | Expected |
|---|---|---|
| Full five-scenario walkthrough | Chromium, no WebMCP host | Pill reads `in-page only`; every scenario behaves identically |
| Tool registration visible in DevTools | Chrome 149+, `#enable-webmcp-testing` | Application → WebMCP lists 8, then 9 after approval, then 8 again |
| Agent-driven diagnosis | ChatGPT in-app browser | Agent calls `list_operations`, discovers the gate, calls `request_authority`, polls, completes after approval |
| Grant expiry with no call | Either | Countdown reaches zero, tool disappears, `grant.expired` in the ledger |
| Reload mid-incident | Either | State restored from `localStorage`, ledger still verifies, live grants still counting |
| Hand-edited `localStorage` | Either | *Verify chain* reports the broken entry and reason |
| Narrow viewport | 375 px | Panels stack, no horizontal scroll, tool surface still legible |
| Reduced motion | `prefers-reduced-motion` | Arrival and pulse animations disabled |
| `?resultMode=string` | Either | Tools return plain strings instead of content blocks |

## Evals

Tool-*selection* quality is a different question from tool correctness, and it
is probabilistic. [`evals/`](../evals/) holds cases in the format from
[Chrome's WebMCP evals guide](https://developer.chrome.com/docs/ai/webmcp/evals),
including the cases that matter most here: that an agent asked to fix production
reaches for `request_authority` rather than retrying a tool that does not exist,
and that an agent fed an injected log line does **not** reach for
`scale_service`.
