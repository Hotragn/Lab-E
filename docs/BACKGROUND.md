# Background: why this exists

Notes from the research that produced LABE, with sources and dates. Most
writing about WebMCP on the open web is already stale, so dates matter more
than usual here.

Researched 2026-09-02.

---

## The API moved, and most tutorials are wrong

`navigator.modelContext` → `document.modelContext` on **21 July 2026**. Chrome
150 deprecated the old location while the origin trial still ships it, so a
real deployment has to probe both.
([State of WebMCP, July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/))

→ `probeModelContext()` checks both and reports which one answered. Anything
that only checks `document` will silently register nothing on some browsers,
and anything that only checks `navigator` is already broken.

## The specification has no security section

> "The WebMCP specification's Security and Privacy section is empty, containing
> only a TODO comment"

No normative guidance on prompt injection through tool descriptions, on
informing users when tools are registered, or on isolating cross-origin tool
data. The standard "doesn't prevent deceived models from calling legitimate
tools."

→ This is the gap LABE is a proposal for. It is the largest unfilled hole in
the standard, and every adopter inherits it by default.

## Runtime tool-surface manipulation is a named attack

*WebMCP Tool Surface Poisoning: Runtime Manipulation Attacks on LLM Agents*
([arXiv 2606.06387](https://arxiv.org/pdf/2606.06387)) — mutating the tool
surface at runtime is an attack primitive with a paper behind it.

→ LABE uses the same primitive defensively, which is worth stating plainly
rather than glossing: **a page that can add a tool mid-session can add a
hostile one.** LABE's answer is that mutation only ever follows a human
decision, and every mutation is in the ledger. That is a mitigation, not an
immunity — if the page itself is compromised, nothing in the page can save you.

## The authorisation model existed in theory, unshipped

*Agent Operating Systems* ([arXiv 2606.01508](https://arxiv.org/pdf/2606.01508)):

> "A capability specifies which tools can be invoked, which resource scopes
> apply, which parameter ranges are permitted, which time windows are valid, and
> whether human approval is required."

Every field of that sentence maps onto LABE's grant object: `operationId`,
`scopeRef`, `caps`, `ttlMs`, and the approval step itself.

→ The gap was implementation, not theory. Nobody had expressed capabilities
through WebMCP's registration lifecycle, which is the one place the browser
gives you a revocable handle.

## Almost nothing is deployed, and the tooling is lopsided

> "Approximately zero real-world deployment outside pilots and checker tools
> themselves." · "Checker-tool oversupply: more validators exist than actual
> implementations."

→ Two consequences. First, LABE is infrastructure for something still
arriving — see the honesty section in the [README](../README.md#what-is-real-and-what-is-not).
Second, this killed an earlier version of this project: a WebMCP tool
auditor/linter, abandoned once it was clear the ecosystem already has more
validators than implementations.

We later measured the deployment claim ourselves rather than trusting the
write-up — see [FIELD-SURVEY.md](FIELD-SURVEY.md). It held up.

## Chrome names the failure modes and the budgets

[Chrome's evals guide](https://developer.chrome.com/docs/ai/webmcp/evals) names
six failure modes: wrong tool selection, incorrect sequencing, bad parameters,
faulty output, runtime errors, mid-chain failures. The
[secure-tools guide](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
gives budgets — ≤500 characters per description, ≤150 per parameter, ≤30 per
name, ≈1.5K per result — and says read-write tools should reach only origins
you trust to act for the user.

→ The budgets are asserted in `bridge.test.ts`; they are cheap to regress and
cheap to test. Four of the six failure modes have eval cases in
[`evals/`](../evals/). `exposedTo` is left unset by default.

## "Why not just use an API?"

The standing objection ([Ask HN](https://news.ycombinator.com/item?id=47085076)),
and the answers that survive contact:

- internal tools behind browser SSO that will never get a REST endpoint
- business logic that only exists client-side
- and decisively: **no long-lived token is handed to the agent**

> "APIs and WebMCP don't have the same purpose: WebMCP allows agents to assist
> humans on their own interface."

→ This is load-bearing for LABE specifically. An API-first design cannot
express *"you may roll back this one deployment, once, in the next two
minutes."* Short-lived scoped authority inside the operator's own session is
the thing WebMCP makes possible and an API key makes awkward.

## Adjacent evidence that unbounded agency underperforms

OpenAI ended Instant Checkout in March 2026 with roughly 30 merchants live;
Walmart measured in-chat checkout converting about 3× worse than click-through.
The model shifted to discover-in-AI, act-on-site.

→ Weak evidence for this specific design, and cited for completeness rather
than leaned on. It does support the general shape: agent-*assisted* action
inside the user's own surface outperformed agent-*replaced* action.

## Prior art worth knowing about

The pattern LABE implements is ordinary security practice wearing new clothes:

- **Capability-based security** and the principle of least authority (POLA)
- **Short-lived scoped credentials** — AWS STS, OAuth scopes, `sudo` timeouts
- **Physical analogues** — hotel keycards, valet keys

None of that is novel. What is novel is that the browser now offers a tool
surface you can revoke mid-session, which is the first time this pattern has
been expressible in a web page rather than at an API boundary.

## Sources

- [Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp) · [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) · [secure tools](https://developer.chrome.com/docs/ai/webmcp/secure-tools) · [evals](https://developer.chrome.com/docs/ai/webmcp/evals) · [DevTools](https://developer.chrome.com/docs/devtools/application/webmcp)
- [WebMCP explainer](https://github.com/webmachinelearning/webmcp) · [origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial)
- [The State of WebMCP: July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- [Cloudflare on WebMCP](https://blog.cloudflare.com/webmcp/)
- [Agent security considerations for WebMCP](https://developer.chrome.com/docs/agents/security)
- arXiv [2606.06387](https://arxiv.org/pdf/2606.06387) — Tool Surface Poisoning · [2606.01508](https://arxiv.org/pdf/2606.01508) — Agent Operating Systems
- [Ask HN: What is the point of WebMCP?](https://news.ycombinator.com/item?id=47085076) · [WebMCP Proposal](https://news.ycombinator.com/item?id=47037501)
- [Simon Willison on MCP prompt injection](https://simonwillison.net/2025/Apr/9/mcp-prompt-injection/)
