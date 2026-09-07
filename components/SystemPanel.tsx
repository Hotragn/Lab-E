"use client";

import { buildSeries, type TelemetryPoint } from "@/lib/domain/telemetry";
import type { LabeState, Service } from "@/lib/domain/types";
import { PANELS } from "@/lib/copy";
import { Chip, Panel, cx } from "./ui";

/**
 * Services and deployments.
 *
 * Every number here is the same number `get_system_state` returns. If the
 * console and the agent ever disagreed, one of them would be reading the DOM.
 */
export function SystemPanel({ state, now }: { state: LabeState; now: number }) {
  return (
    <Panel
      title={PANELS.systems.title}
      sub={PANELS.systems.sub}
      meta={
        <span className="num text-[11px] text-ink-faint">
          {state.services.length} services · {state.deploys.filter((d) => d.active).length}{" "}
          live builds
        </span>
      }
    >
      <div className="grid gap-px bg-rule sm:grid-cols-2">
        {state.services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            state={state}
            now={now}
          />
        ))}
      </div>

      <div className="mt-4">
        <span className="text-[12.5px] font-medium text-ink">Recent releases</span>
        <div className="mt-2 flex flex-col divide-y divide-rule">
          {state.deploys
            .slice()
            .sort((a, b) => b.at - a.at)
            .map((deploy) => (
              <div key={deploy.id} className="flex items-baseline gap-3 py-1.5">
                <span className="num w-16 shrink-0 text-[11px] text-ink-faint">
                  {deploy.id}
                </span>
                <span
                  className={cx(
                    "num w-16 shrink-0 text-[12px]",
                    deploy.active ? "font-semibold text-ink" : "text-ink-faint",
                  )}
                >
                  {deploy.sha}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
                  {deploy.message}
                  <span className="ml-2 text-ink-faint">{deploy.author}</span>
                </span>
                <span className="num shrink-0 text-[11px] text-ink-faint">
                  {Math.round((now - deploy.at) / 60000)}m
                </span>
                {deploy.active ? <Chip tone="live">active</Chip> : null}
              </div>
            ))}
        </div>
      </div>
    </Panel>
  );
}

function ServiceCard({
  service,
  state,
  now,
}: {
  service: Service;
  state: LabeState;
  now: number;
}) {
  const activeDeploy = state.deploys.find(
    (d) => d.serviceId === service.id && d.active,
  );
  const series = buildSeries(service, activeDeploy, now, 60, 48);
  const tone =
    service.health === "healthy" ? "live" : service.health === "degraded" ? "warn" : "deny";

  return (
    <div className="bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-[13px] font-semibold text-ink">{service.name}</span>
        <Chip tone={tone}>{service.health}</Chip>
      </div>

      <div className="mt-2 flex items-baseline gap-4">
        <Metric
          label="failing"
          title="Share of requests coming back as a server error. Anything over 0.5% breaches the target."
          value={`${service.errorRatePct.toFixed(2)}%`}
          tone={service.errorRatePct > 0.5 ? "deny" : "neutral"}
        />
        <Metric
          label="slow page"
          title="How long the slowest 5% of requests take (p95 latency)."
          value={`${service.p95Ms}ms`}
        />
        <Metric
          label="servers"
          title="How many copies of this service are running, and the range it is allowed to run in."
          value={`${service.replicas}`}
          hint={`of ${service.minReplicas}–${service.maxReplicas}`}
        />
      </div>

      <Sparkline points={series} tone={tone} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
  hint,
  title,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "deny";
  hint?: string;
  /** Plain-English explanation on hover, so the label can stay short. */
  title?: string;
}) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="label">{label}</span>
      <span
        className={cx(
          "num text-[13px]",
          tone === "deny" ? "font-semibold text-deny" : "text-ink",
        )}
      >
        {value}
        {hint ? <span className="ml-1 text-[10px] text-ink-faint">{hint}</span> : null}
      </span>
    </div>
  );
}

/** Error-rate sparkline. The step is the deploy; that is the whole story. */
function Sparkline({
  points,
  tone,
}: {
  points: TelemetryPoint[];
  tone: "live" | "warn" | "deny";
}) {
  const w = 240;
  const h = 30;
  const max = Math.max(0.4, ...points.map((p) => p.errorRatePct));
  const step = points.length > 1 ? w / (points.length - 1) : w;

  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p.errorRatePct / max) * (h - 3) - 1.5;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const stroke =
    tone === "live"
      ? "var(--color-live)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "var(--color-deny)";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2.5 block w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Error rate over the last hour, peaking at ${max.toFixed(2)} percent`}
    >
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="var(--color-rule)" strokeWidth="1" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
