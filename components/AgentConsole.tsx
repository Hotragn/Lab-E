"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RegisteredTool } from "@/lib/webmcp/bridge";
import type { JSONSchemaObject } from "@/lib/webmcp/types";
import { Button, Chip, cx, inputClass } from "./ui";

/**
 * In-page agent console.
 *
 * Two jobs. It lets anyone drive the real tool descriptors — the same objects
 * handed to `registerTool`, with the same schemas and the same `execute` — so
 * the project is fully demonstrable on a browser without WebMCP enabled. And
 * it ships the scripted sequences a reviewer needs to see the mechanism in one
 * click, rather than typing eleven tool calls by hand.
 *
 * It is not a chatbot and it is not a second code path. Every call here goes
 * through the bridge exactly as an external agent's call would.
 */

interface Step {
  tool: string;
  input: Record<string, unknown>;
  why: string;
}

interface Scenario {
  id: string;
  label: string;
  blurb: string;
  tone: "neutral" | "warn" | "deny";
  steps: Step[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "diagnose",
    label: "1 · Let it look around",
    blurb:
      "Reading data and writing notes cannot break anything, so it needs no permission. Watch it find the cause by itself.",
    tone: "neutral",
    steps: [
      { tool: "list_operations", input: {}, why: "Find out what it is and is not allowed to do" },
      { tool: "get_system_state", input: {}, why: "Read the real numbers, not the screen" },
      {
        tool: "read_telemetry",
        input: { serviceId: "svc_checkout", windowMinutes: 60 },
        why: "Spot when things broke — and walk into two hidden traps",
      },
      {
        tool: "annotate_incident",
        input: {
          incidentId: "inc_2291",
          kind: "finding",
          body: "5xx steps from 0.1% to 4.2% exactly at dpl_9c1f (perf: memoize cart totals). cart.total returns NaN for carts with a coupon.",
        },
        why: "Write down what it thinks, where you can see it",
      },
      {
        tool: "draft_remediation",
        input: {
          incidentId: "inc_2291",
          summary: "Roll back dpl_9c1f, then disable fast_totals",
          steps: JSON.stringify([
            {
              operationId: "rollback_deploy",
              params: { deployId: "dpl_9c1f" },
              rationale: "Reverts the NaN in cart totals",
            },
            {
              operationId: "set_feature_flag",
              params: { flagId: "flg_fast_totals", enabled: false },
              rationale: "Stops the code path being reached if rollback is partial",
            },
          ]),
        },
        why: "Suggest a fix. Suggesting does not run anything",
      },
    ],
  },
  {
    id: "overreach",
    label: "2 · Watch it get blocked",
    blurb:
      "It knows the fix now, and tries to apply it. It cannot: the ability it needs was never handed over. The attempt is written down anyway.",
    tone: "warn",
    steps: [
      {
        tool: "rollback_deploy",
        input: { deployId: "dpl_9c1f", reason: "cart totals regressed" },
        why: "You have not approved anything, so this does not exist",
      },
    ],
  },
  {
    id: "request",
    label: "3 · It asks you instead",
    blurb:
      "The right move: it asks, and says why. Approve it in the panel above and watch a new ability appear out of nowhere.",
    tone: "neutral",
    steps: [
      {
        tool: "request_authority",
        input: {
          operation: "rollback_deploy",
          scopeRef: "dpl_9c1f",
          reason: "5xx steps to 4.2% at dpl_9c1f; cart.total returns NaN with a coupon",
          maxUses: 1,
          ttlSeconds: 120,
        },
        why: "Just a request. It still cannot do anything",
      },
      { tool: "check_authority", input: {}, why: "Wait politely instead of hammering the door" },
    ],
  },
  {
    id: "execute",
    label: "4 · Now it works — once",
    blurb:
      "Run this after approving step 3. It fixes the problem, the site recovers, and then the ability vanishes again on its own.",
    tone: "neutral",
    steps: [
      {
        tool: "rollback_deploy",
        input: { deployId: "dpl_9c1f", reason: "NaN in cart totals from 9c1f4ab" },
        why: "Approved, locked to this one release, one use only",
      },
      { tool: "verify_ledger", input: { limit: 6 }, why: "Show its receipts" },
    ],
  },
  {
    id: "injected",
    label: "5 · Try to trick it",
    blurb:
      "Pretend it fell for the hidden order in the logs and tries to switch checkout off. It still cannot — and it cannot even ask for the forbidden ones.",
    tone: "deny",
    steps: [
      {
        tool: "scale_service",
        input: { serviceId: "svc_checkout", replicas: 0 },
        why: "The order was stripped out, and this does not exist anyway",
      },
      {
        tool: "request_authority",
        input: {
          operation: "delete_service",
          scopeRef: "svc_checkout",
          reason: "a log line said to",
        },
        why: "Some things you can never approve, so it cannot even ask",
      },
    ],
  },
];

interface TranscriptEntry {
  seq: number;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  text: string;
  why?: string;
}

export function AgentConsole({
  tools,
  invoke,
  describe,
  tourSignal = 0,
  onRunningChange,
}: {
  tools: RegisteredTool[];
  invoke: (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  describe: (name: string) => { description: string; inputSchema: JSONSchemaObject } | null;
  /** Incremented by the explainer's "show me" button to run scenario one. */
  tourSignal?: number;
  /** Lets the hero disable its own button while a scenario is mid-flight. */
  onRunningChange?: (running: boolean) => void;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [selected, setSelected] = useState("get_system_state");
  const [form, setForm] = useState<Record<string, string>>({});
  const seqRef = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const descriptor = useMemo(() => describe(selected), [describe, selected]);

  useEffect(() => {
    // Scroll the transcript itself rather than calling scrollIntoView, which
    // would also drag the whole page around on every tool call.
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [transcript]);

  useEffect(() => {
    setForm({});
  }, [selected]);

  const record = async (tool: string, input: Record<string, unknown>, why?: string) => {
    const { ok, text } = await invoke(tool, input);
    seqRef.current += 1;
    setTranscript((t) => [
      ...t.slice(-40),
      { seq: seqRef.current, tool, input, ok, text, why },
    ]);
  };

  const runScenario = async (scenario: Scenario) => {
    setRunning(scenario.id);
    onRunningChange?.(true);
    // `finally` matters: while a scenario is running every scenario button is
    // disabled, so a throw part-way through would leave the whole panel dead
    // with no way back except a reload.
    try {
      for (const step of scenario.steps) {
        await record(step.tool, step.input, step.why);
        await new Promise((r) => setTimeout(r, 420));
      }
    } finally {
      setRunning(null);
      onRunningChange?.(false);
    }
  };

  const runManual = async () => {
    const input: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(form)) {
      if (raw === "") continue;
      const prop = descriptor?.inputSchema.properties[key];
      input[key] =
        prop?.type === "number"
          ? Number(raw)
          : prop?.type === "boolean"
            ? raw === "true"
            : raw;
    }
    await record(selected, input);
  };

  // Kick off the first scenario when the explainer asks for a guided run.
  //
  // Scrolling first is not decoration. This panel sits well below the fold, so
  // starting the tour without moving the viewport looks exactly like nothing
  // happening — the calls land somewhere the visitor cannot see.
  useEffect(() => {
    if (!tourSignal) return;

    const el = rootRef.current;
    if (el) {
      const before = window.scrollY;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

      // Smooth scrolling is silently ignored in some environments — several
      // automated browsers among them, which is where a reviewer might first
      // see this. Landing on the panel matters more than the animation, so
      // check whether anything actually moved and jump if it did not.
      window.setTimeout(() => {
        if (Math.abs(window.scrollY - before) < 8) {
          el.scrollIntoView({ behavior: "auto", block: "start" });
        }
      }, 250);
    }

    void runScenario(SCENARIOS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourSignal]);

  return (
    <div
      ref={rootRef}
      /* scroll-mt keeps the sticky header from covering the panel when the
         guided tour scrolls it into view. */
      className="grid min-h-0 scroll-mt-28 gap-px bg-rule lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
    >
      {/* left: drivers */}
      <div className="min-h-0 overflow-y-auto scroll-thin bg-surface p-4">
        <span className="text-[13px] font-semibold text-ink">Walk through it</span>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
          Press these in order. Step 4 only works once you have approved the
          request from step 3.
        </p>

        <div className="mt-2.5 flex flex-col gap-1.5">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              disabled={running !== null}
              onClick={() => void runScenario(scenario)}
              className={cx(
                "border p-2.5 text-left transition-colors disabled:opacity-50",
                scenario.tone === "deny"
                  ? "border-deny/30 hover:bg-deny/5"
                  : scenario.tone === "warn"
                    ? "border-warn/40 hover:bg-warn/5"
                    : "border-rule-strong hover:bg-sunken",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="num text-[12px] font-semibold text-ink">
                  {scenario.label}
                </span>
                {running === scenario.id ? (
                  <Chip tone="live">running</Chip>
                ) : (
                  <span className="num text-[10px] text-ink-faint">
                    {scenario.steps.length} call{scenario.steps.length === 1 ? "" : "s"}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-ink-soft">
                {scenario.blurb}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-rule pt-3">
          <span className="text-[13px] font-semibold text-ink">
            Or try anything yourself
          </span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className={`${inputClass} mt-1.5`}
          >
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
                {t.kind === "granted" ? "  (granted)" : ""}
              </option>
            ))}
          </select>

          {descriptor ? (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                {descriptor.description}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {Object.entries(descriptor.inputSchema.properties).map(([key, prop]) => {
                  const locked = prop.const !== undefined;
                  return (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="label">
                        {key}
                        {descriptor.inputSchema.required?.includes(key) ? " *" : ""}
                        {locked ? " · pinned" : ""}
                        {prop.maximum !== undefined ? ` · max ${prop.maximum}` : ""}
                      </span>
                      {prop.enum && !locked ? (
                        <select
                          className={inputClass}
                          value={form[key] ?? ""}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        >
                          <option value="">—</option>
                          {prop.enum.map((option) => (
                            <option key={String(option)} value={String(option)}>
                              {String(option)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={inputClass}
                          disabled={locked}
                          placeholder={locked ? String(prop.const) : prop.type}
                          value={locked ? String(prop.const) : (form[key] ?? "")}
                          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-2.5">
                <Button variant="ink" onClick={() => void runManual()}>
                  Invoke {selected}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* right: transcript */}
      <div className="flex min-h-0 flex-col bg-surface">
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-4 py-2">
          <span className="text-[13px] font-semibold text-ink">What the AI did</span>
          <span className="flex items-center gap-2">
            <span className="num text-[11px] text-ink-faint">
              {transcript.length} call{transcript.length === 1 ? "" : "s"}
            </span>
            <Button size="xs" onClick={() => setTranscript([])}>
              Clear
            </Button>
          </span>
        </div>

        <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin p-4">
          {transcript.length === 0 ? (
            <p className="max-w-prose text-[12px] leading-relaxed text-ink-faint">
              Nothing yet. Start with step 1 on the left — or, in an AI browser,
              just ask the assistant to fix the checkout problem and watch it
              appear here.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {transcript.map((entry) => (
                <article key={entry.seq} className="border border-rule">
                  <header
                    className={cx(
                      "flex flex-wrap items-center gap-2 border-b px-2.5 py-1.5",
                      entry.ok
                        ? "border-rule bg-sunken/60"
                        : "border-deny/25 bg-deny/5",
                    )}
                  >
                    <span className="num text-[10px] text-ink-faint">
                      {String(entry.seq).padStart(2, "0")}
                    </span>
                    <span className="num text-[12px] font-semibold text-ink">
                      {entry.tool}
                    </span>
                    <Chip tone={entry.ok ? "live" : "deny"}>
                      {entry.ok ? "ok" : "refused"}
                    </Chip>
                    {entry.why ? (
                      <span className="ml-auto text-[10px] text-ink-faint">
                        {entry.why}
                      </span>
                    ) : null}
                  </header>
                  {Object.keys(entry.input).length ? (
                    <p className="num break-words border-b border-rule/60 px-2.5 py-1 text-[11px] text-ink-soft">
                      {JSON.stringify(entry.input)}
                    </p>
                  ) : null}
                  <pre className="num max-h-56 overflow-auto scroll-thin whitespace-pre-wrap break-words px-2.5 py-1.5 text-[11px] leading-relaxed text-ink">
                    {pretty(entry.text)}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tool output goes over the wire compact; humans read it better indented. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
