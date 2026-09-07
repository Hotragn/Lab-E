"use client";

import { useEffect, useState } from "react";
import { policyFor } from "@/lib/domain/authority";
import { OPERATIONS } from "@/lib/domain/operations";
import { BRAND, TABS } from "@/lib/copy";
import { useConsole } from "@/lib/webmcp/useConsole";
import { AgentConsole } from "./AgentConsole";
import { AuthorityInbox } from "./AuthorityInbox";
import { IncidentPanel } from "./IncidentPanel";
import { LedgerPanel } from "./LedgerPanel";
import { Onboarding } from "./Onboarding";
import { PolicyPanel } from "./PolicyPanel";
import { QuarantinePanel } from "./QuarantinePanel";
import { SystemPanel } from "./SystemPanel";
import { Keyring } from "./Keyring";
import { WhatWhy } from "./WhatWhy";
import { Button, Chip, Dot, cx } from "./ui";

type Tab = "agent" | "ledger" | "policy" | "quarantine";

const TAB_ORDER: Tab[] = ["agent", "ledger", "policy", "quarantine"];
const ONBOARDED_KEY = "labe.onboarded.v1";

export function Console() {
  const api = useConsole();
  const [tab, setTab] = useState<Tab>("agent");
  const [onboarding, setOnboarding] = useState(false);
  const [tourSignal, setTourSignal] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);

  const { state, tools, status, now, dispatch, invoke, describe, reset, ready } = api;

  // Show the explainer on a first visit only, once the console is up.
  useEffect(() => {
    if (!ready) return;
    try {
      if (!window.localStorage.getItem(ONBOARDED_KEY)) setOnboarding(true);
    } catch {
      /* storage blocked; skip the explainer rather than break the page */
    }
  }, [ready]);

  const closeOnboarding = () => {
    setOnboarding(false);
    try {
      window.localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const startTour = () => {
    closeOnboarding();
    setTab("agent");
    setTourSignal((n) => n + 1);
  };

  const alwaysOn = tools.filter((t) => t.kind === "base").length;
  const approved = tools.filter((t) => t.kind === "granted").length;
  const withheld = OPERATIONS.filter((op) => {
    const policy = policyFor(state, op.id);
    return (
      (policy === "grant" || policy === "forbidden") &&
      !tools.some((t) => t.kind === "granted" && t.operationId === op.id)
    );
  }).length;

  const pending = state.grants.filter((g) => g.status === "pending").length;

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="label pulse">Starting…</p>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] flex-col">
      <Onboarding
        open={onboarding}
        onClose={closeOnboarding}
        onStartTour={startTour}
      />

      {/* ------------------------------- header ------------------------------ */}
      <header className="sticky top-0 z-20 border-b border-rule bg-paper/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/labe-mark.svg" alt="" width={30} height={30} />
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold tracking-[0.16em] text-ink">
                {BRAND.name}
              </span>
              <span className="text-[11.5px] text-ink-soft">{BRAND.tagline}</span>
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {pending > 0 ? <Chip tone="warn">{pending} waiting for you</Chip> : null}
            <span
              className="flex items-center gap-1.5 border border-rule bg-surface px-2 py-1"
              title={
                status.live
                  ? `Tools are registered on ${status.surface}.modelContext, so a WebMCP agent can call them.`
                  : "No AI browser detected. Everything still works — use the Try it panel below, which drives exactly the same tools."
              }
            >
              <Dot tone={status.live ? "live" : "warn"} pulse={status.live} />
              <span className="num text-[11px] text-ink-soft">
                {status.live ? `${status.surface}.modelContext` : "no AI browser"}
              </span>
            </span>
            <Button size="xs" onClick={() => setOnboarding(true)}>
              How it works
            </Button>
            <Button size="xs" onClick={reset} title="Put the broken system back">
              Reset
            </Button>
          </div>
        </div>

        {/* one plain sentence, then the live count */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-rule bg-sunken/60 px-5 py-2">
          <p className="max-w-prose text-[12px] leading-relaxed text-ink">
            {BRAND.standfirst}
          </p>
          <span className="ml-auto flex items-center gap-3">
            <Stat n={alwaysOn} label="safe tools" tone="neutral" />
            <Stat n={approved} label="you approved" tone="live" />
            <Stat n={withheld} label="withheld" tone="deny" />
          </span>
        </div>
      </header>

      {/* -------------------------------- main ------------------------------- */}
      <main id="main" className="flex flex-1 flex-col gap-4 p-4 lg:p-5">
        {/* The hero: the only thing on this page that is actually novel. */}
        <Keyring
          tools={tools}
          state={state}
          now={now}
          status={status}
          onRunDemo={startTour}
          demoRunning={demoRunning}
        />

        <AuthorityInbox state={state} now={now} dispatch={dispatch} />

        <WhatWhy />

        {/* Context, not content: the charts sit below the argument. */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <IncidentPanel state={state} now={now} dispatch={dispatch} />
          <SystemPanel state={state} now={now} />
        </div>

        {/* ----------------------------- workbench ---------------------------- */}
        <section className="flex min-h-[30rem] flex-col border border-rule bg-surface">
          <div
            role="tablist"
            aria-label="Console tools"
            className="flex shrink-0 flex-wrap items-center gap-px border-b border-rule bg-rule/40"
          >
            {TAB_ORDER.map((id) => {
              const t = TABS[id];
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cx(
                    "flex items-baseline gap-1.5 px-4 py-2.5 transition-colors",
                    tab === id
                      ? "bg-surface"
                      : "bg-sunken/70 hover:bg-surface/70",
                  )}
                >
                  <span
                    className={cx(
                      "text-[12.5px] font-medium",
                      tab === id ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    {t.title}
                  </span>
                  {id === "quarantine" && state.quarantine.length > 0 ? (
                    <span className="num text-[11px] text-deny">
                      {state.quarantine.length}
                    </span>
                  ) : null}
                  {id === "ledger" ? (
                    <span className="num text-[11px] text-ink-faint">
                      {state.ledger.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
            <span className="label ml-auto hidden pr-4 sm:block">
              {TABS[tab].sub}
            </span>
          </div>

          <div className="min-h-0 flex-1">
            {tab === "agent" ? (
              <AgentConsole
                tools={tools}
                invoke={invoke}
                describe={describe}
                tourSignal={tourSignal}
                onRunningChange={setDemoRunning}
              />
            ) : null}
            {tab === "ledger" ? <LedgerPanel state={state} /> : null}
            {tab === "policy" ? <PolicyPanel state={state} dispatch={dispatch} /> : null}
            {tab === "quarantine" ? <QuarantinePanel state={state} /> : null}
          </div>
        </section>
      </main>

      {/* ------------------------------- footer ------------------------------ */}
      <footer className="border-t border-rule px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-ink-faint">
          <span>
            {BRAND.name} — {BRAND.role}. Open source, MIT licensed.
          </span>
          <a
            className="text-human underline decoration-human/30 hover:decoration-human"
            href="https://github.com/Hotragn/Lab-E"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
          <a
            className="text-human underline decoration-human/30 hover:decoration-human"
            href="https://developer.chrome.com/docs/ai/webmcp"
            target="_blank"
            rel="noreferrer"
          >
            What is WebMCP?
          </a>
          <span className="ml-auto">
            Everything stays in this browser. No real servers, no accounts.
          </span>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "neutral" | "live" | "deny";
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cx(
          "num text-[15px] font-semibold",
          tone === "live" ? "text-live" : tone === "deny" ? "text-ink-faint" : "text-ink",
        )}
      >
        {n}
      </span>
      <span className="label">{label}</span>
    </span>
  );
}
