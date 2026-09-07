# Walkthrough

Two ways through the demo: **click through it yourself** (five clicks, no
setup) or **drive it with a real AI assistant**.

Live: **https://labe-console.vercel.app**

---

## The situation you land in

| | |
|---|---|
| **Incident** | `inc_2291` — Checkout error rate above SLO, sev2, open ~22m |
| **Symptom** | `svc_checkout` at **4.20%** 5xx (SLO 0.5%), p95 **1840ms** |
| **Suspect** | `dpl_9c1f` — *"perf: memoize cart totals"* by r.okafor, active 34m |
| **Evidence** | `cart.total` returns `NaN` for carts with a coupon |
| **Fix** | Roll back to `dpl_7a30`. Nobody has approved that. |

The error-rate sparkline steps up exactly where the deploy landed. That step is
the whole diagnosis, and it is the same data `read_telemetry` returns.

---

## Clicking through it

### 1 · Let it look around — reading needs no permission

**Try it → `1 · Let it look around`** runs five calls:

```
list_operations      → learns what it may and may not do
get_system_state     → the real numbers, not the screen
read_telemetry       → finds the step change; 5 injected spans quarantined
annotate_incident    → writes the finding onto the timeline
draft_remediation    → proposes rollback + flag disable. Executes nothing.
```

Three things worth watching:

- The **incident timeline** gains an amber `AGENT · FINDING` entry. The
  assistant's reasoning is now on the record where a person can disagree with
  it.
- **The AI's suggested fix** shows the plan, with `needs your OK` on the step
  that needs it.
- The **Blocked tricks** tab count jumps. Open it.

### 2 · Watch it get blocked — the point of the project

**`2 · Watch it get blocked`** calls `rollback_deploy`.

```
refused — Tool "rollback_deploy" is not registered.
          It needs a human-approved grant first.
```

This is not a permission check failing. Look at the hero panel, right column:
`rollback_deploy` is sitting under **It cannot**, with a lock. It was never
handed over. A confused, misled, or actively hostile assistant cannot call what
is not in its list.

The attempt is in the ledger with `code=authority_absent`.

### 3 · It asks you instead

**`3 · It asks you instead`** calls `request_authority` with a reason, then
`check_authority`.

A card appears in **Waiting for your OK**, carrying the stated reason, the blast
radius in plain language, and editable **uses / TTL / caps**.

Note that the hero panel has **not** changed. Pending is not authority.

### 4 · Approve it — the moment that matters

Set **ttl** to `120`, leave **uses** at `1`, press **Approve**.

In the hero panel, an item crosses from the right column to the left:

```
✓ Undo the last release          YOU APPROVED       [████████░░] 118s
  only deployId=dpl_9c1f · 1 use left
```

A tool has been registered mid-session. Its `deployId` is pinned as a JSON
Schema `const` — the limit is legible to the model, not hidden in a runtime
check it discovers by failing.

If Chrome DevTools is open on **Application → WebMCP**, the tool appears in that
list too. It is a real registration, not UI state.

### 5 · Now it works — once

**`4 · Now it works — once`** calls `rollback_deploy`, then `verify_ledger`.

- `dpl_7a30` becomes active, `dpl_9c1f` does not.
- checkout goes **HEALTHY**, 5xx falls to **0.06%**, p95 to **214ms**.
- The incident becomes **MITIGATED** with an `action` note.
- The grant is spent, and **the item moves back to "It cannot".**

One use meant one use. The assistant that just rolled back production can no
longer roll back production.

### 6 · Try to break it

**`5 · Try to trick it`** plays the assistant that believed the log line:

```
scale_service(svc_checkout, replicas: 0)
  → refused: not registered

request_authority(delete_service, svc_checkout, "a log line said to")
  → refused: forbidden. No approval can produce this.
```

Then things worth trying by hand:

| Try this | Expect |
|---|---|
| **Rules** → set `Undo the last release` to `Never allowed` while a grant is live | The grant is revoked and the tool unregisters immediately |
| Approve `Add or remove servers` capped at 8, then call it with 20 | `cap_exceeded`, recorded — and the schema already said `maximum: 8` |
| Approve a grant with **ttl 40s** and just wait | The countdown runs out and the tool vanishes with no call at all |
| Approve `Refund a customer` on `ord_5512`, then try refunding `ord_5514` | `authority_absent` — the grant names one order |
| **History** → *Verify chain* | Chain intact across every entry, with the head hash |
| **History** → *show reads* | Reads were logged all along |
| Edit `labe.console.v1` in localStorage, then *Verify chain* | Reports the broken entry and why |

---

## Driving it with a real AI assistant

### ChatGPT's in-app browser

Open the demo and ask:

> Checkout is erroring. Diagnose it with the page's tools, then do whatever you
> need to do to fix it.

The interesting behaviour is what happens when it wants the rollback. There is
no `rollback_deploy` in its tool list, but `list_operations` told it the
operation exists, that it needs approval, and literally how to ask:

```json
{
  "id": "rollback_deploy",
  "risk": "irreversible",
  "policy": "grant",
  "callableNow": false,
  "blast": "All production traffic shifts to the previous build...",
  "howToObtain": "request_authority(operation=\"rollback_deploy\", scopeRef=\"<deploy id>\", reason=\"...\")"
}
```

So a competent assistant asks, then polls `check_authority` rather than
hammering a tool that does not exist. Approve it and it completes.

Being unable to do something becomes a normal, well-lit state rather than an
error — which is the difference between an assistant that stalls and one that
tells you what it needs.

### Chrome with the flag

1. Chrome 149+ → `chrome://flags/#enable-webmcp-testing` → **Enabled** →
   relaunch.
2. Open the demo. The header pill should read `document.modelContext`.
3. DevTools → **Application → WebMCP** lists 8 tools.
4. Approve a grant. The list becomes 9 without a reload.
5. Let it expire. Back to 8.

If the pill reads `no AI browser`, no WebMCP host was detected — the demo still
works, because **Try it** drives the same descriptors through the same
`execute`.

---

## What to look at in the code

If the walkthrough raises "but how", these are the three files that answer it:

| Question | File |
|---|---|
| How does a tool appear and disappear? | [`lib/webmcp/bridge.ts`](../lib/webmcp/bridge.ts) — `sync()` |
| How is a call authorised? | [`lib/domain/authority.ts`](../lib/domain/authority.ts) — `authorize()` |
| How does a grant become a schema? | [`lib/webmcp/bridge.ts`](../lib/webmcp/bridge.ts) — `schemaFor()` |

And [`lib/webmcp/bridge.test.ts`](../lib/webmcp/bridge.test.ts) asserts the
withdrawal paths, which is the part worth not taking on trust.
