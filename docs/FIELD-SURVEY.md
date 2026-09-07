# Field survey: how the reference WebMCP apps actually hand over tools

Run on **2026-09-02** from a real browser (Chrome 148), against the
best-known public WebMCP demos — the reference implementations published by
Cloudflare, Vercel and Netlify.

The claim in [BACKGROUND.md](BACKGROUND.md) — that existing integrations register
their whole tool surface permanently and gate nothing — was taken from
second-hand write-ups. This is the measured version.

## Method

For each site: load it, probe `document.modelContext` and
`navigator.modelContext`, call `getTools()` if either exists, then fetch the
site's own script bundles and grep them for the WebMCP API surface and for any
vocabulary suggesting a human-approval step (`grant`, `approve`,
`requiresConfirmation`, `pendingApproval`).

Reproduce it by pasting the probe from the bottom of this file into DevTools on
any of these origins.

## Results

| Site | `registerTool` | `readOnlyHint` | `untrustedContentHint` | `exposedTo` | Human-approval gate | Works below Chrome 149 |
|---|---|---|---|---|---|---|
| [Cloudflare coffee store](https://webmcp-coffee.jilles.fyi/) | yes | **yes** | **yes** | no | **no** | no |
| [Vercel storefront template](https://template.vercel.shop/) | feature-detected, lazy-loaded | — | — | no | **no** | no |
| [Netlify WebMCP starter](https://webmcp-starter.netlify.app/) | yes (2) | no | no | no | **no** | no |
| [Cloudflare WebMCP landing](https://webmcp-challenge.examples.workers.dev/) | yes (2) | **yes** | **yes** | no | **no** | no |
| **LABE** (this project) | yes (8 + dynamic) | yes | yes | deliberately unset | **yes** | **yes** |

### 1. Nothing in the reference set gates anything

Zero of the four contain any approval vocabulary. Not `grant`, not `approve`,
not `requiresConfirmation`, not `pendingApproval`.

The coffee store's tools are the clearest case. Extracted from its bundle:

```
filter_coffees_by_roast    read-only
add_to_cart                changes state
remove_from_cart           changes state
update_cart_quantity       changes state
show_confetti              cosmetic
```

Three of those five mutate the user's cart, and all five are registered
together at mount through a single shared hook. There is no path in that code
where a person is asked anything. An agent that arrives — or an agent that has
been talked into it by a product review it just read — can empty the cart.

For a coffee demo that is entirely reasonable. It is a demo. But it is also the
pattern that every builder copying these starters will inherit, and it is the
pattern LABE inverts.

### 2. `exposedTo` is unused everywhere

Zero of four pass it, so all four sit on the browser default. Chrome's
[secure-tools guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
specifically calls out limiting read-write tools to origins you trust to act for
the user, and nobody is exercising that control yet.

LABE also does not pass it — but as a decision rather than an omission: the
allowlist is a named constant, it starts empty, and the code path can only ever
widen tools annotated `readOnlyHint`.

### 3. Annotation hygiene is inconsistent

Cloudflare sets both hints on both of its properties. Netlify's official
starter template — the thing people are told to copy — sets **neither**. So the
first WebMCP code many builders see does not mark read-only tools as read-only,
and does not mark third-party text as untrusted.

### 4. None of them work in my browser, and that is the real finding

I am an AI agent driving a real Chrome 148. `document.modelContext` and
`navigator.modelContext` are both `undefined`, because the API needs Chrome
149+. None of the four ship a polyfill or a fallback.

So all four are, to me, ordinary websites. I could read them. I could not call
a single tool on any of them.

That is first-person confirmation of the "zero agent adoption" finding, and it
is why LABE ships an in-page console that drives the identical tool descriptors
through the identical `execute`. It is the only one of the five that an agent or
anyone can actually exercise today without a flag and a specific Chrome build.

Vercel deserves credit for the most careful approach here: they feature-detect
`"modelContext" in document || "modelContext" in navigator` and lazy-load the
tool code only when support exists. Good engineering — and the reason their
tools could not be enumerated below 149, so their row above is "unknown", not
"absent".

## Honest limits of this survey

- **Minified bundles.** Absence of `approve` / `grant` strings is strong but not
  proof; minifiers rename identifiers. UI text usually survives as string
  literals, which is what the grep targets, but a differently-worded gate could
  hide from it.
- **Vercel could not be inspected.** Their WebMCP chunk never loads below Chrome
  149, so their tool list and annotations are genuinely unknown here, not
  missing. Their [PR #498](https://github.com/vercel/shop/pull/498) is the place
  to look.
- **Homepages only,** except where noted. A site could register different tools
  on a cart or checkout route.
- **Four sites.** These are the best-known public reference implementations,
  not a representative sample of the web.
- **One run, one browser, one date.** All four are moving targets.

None of these limits touch the main result: no approval mechanism appears
anywhere in the reference set, and `exposedTo` is universally unused.

## The probe

```js
// Paste into DevTools on any origin.
const srcs = [...document.querySelectorAll("script[src]")].map((s) => s.src);
const inline = [...document.querySelectorAll("script:not([src])")]
  .map((s) => s.textContent)
  .join("\n");
const all =
  (await Promise.all(srcs.map((s) => fetch(s).then((r) => r.text()).catch(() => ""))))
    .join("\n") + inline;

const has = (re) => re.test(all);
const ctx = document.modelContext || navigator.modelContext;

const report = {
  url: location.href,
  documentModelContext: typeof document.modelContext,
  navigatorModelContext: typeof navigator.modelContext,
  registerToolCalls: (all.match(/registerTool/g) || []).length,
  readOnlyHint: has(/readOnlyHint/),
  untrustedContentHint: has(/untrustedContentHint/),
  exposedTo: has(/exposedTo/),
  approvalGate: {
    grant: has(/\bgrant(ed|s)?\b/i),
    approve: has(/\bapprov(e|al|ed)\b/i),
    confirmRequired: has(/requiresConfirm|needsConfirm|confirmRequired/i),
    pending: has(/pendingApproval|awaitingApproval/i),
  },
  toolNames: [
    ...new Set(
      (all.match(/name\s*:\s*["'`]([a-z][a-z0-9_]{3,30})["'`]/gi) || []).map((m) =>
        m.replace(/.*["'`]([^"'`]+)["'`]/, "$1"),
      ),
    ),
  ].filter((n) => n.includes("_")),
};

if (ctx?.getTools) {
  report.liveTools = (await ctx.getTools()).map((t) => t?.name);
}

report;
```

## Why this is in the repo

Because "everyone else registers everything permanently" is the load-bearing
claim behind LABE, and a claim like that should be checkable rather than
asserted. The probe above makes it a five-minute job to confirm or refute.

If one of these sites adds an approval gate tomorrow, this document is wrong,
and that would be worth knowing.
