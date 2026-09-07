import { TELEMETRY_LOGS } from "./seed";
import type { Deploy, Service } from "./types";

/**
 * Derived telemetry.
 *
 * Deterministic by construction: the same service and window always produce
 * the same series. That matters for two reasons. It keeps server and client
 * renders identical, and it means anyone replaying the demo sees the same
 * spike at the same place every time.
 */

export interface TelemetryPoint {
  t: number;
  errorRatePct: number;
  p95Ms: number;
  rps: number;
}

/** Small deterministic jitter in [-1, 1], stable for a given key. */
function jitter(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2000) / 1000 - 1;
}

const MIN = 60_000;

/**
 * Build a series where the regression begins at the active deployment.
 * Before the deploy the service is at baseline; after it, the current numbers.
 */
export function buildSeries(
  service: Service,
  activeDeploy: Deploy | undefined,
  now: number,
  windowMinutes: number,
  buckets = 40,
): TelemetryPoint[] {
  const span = windowMinutes * MIN;
  const step = span / buckets;
  const breakAt = activeDeploy ? activeDeploy.at : now - span * 2;

  const baseErr = Math.min(0.25, service.errorRatePct * 0.06 + 0.02);
  const baseP95 = Math.max(30, Math.round(service.p95Ms * 0.22));

  const points: TelemetryPoint[] = [];
  for (let i = 0; i < buckets; i++) {
    const t = now - span + i * step;
    const regressed = t >= breakAt;
    const j = jitter(`${service.id}:${i}`);

    const errorRatePct = regressed
      ? Math.max(0, service.errorRatePct + j * service.errorRatePct * 0.18)
      : Math.max(0, baseErr + j * baseErr * 0.5);

    const p95Ms = regressed
      ? Math.max(1, Math.round(service.p95Ms + j * service.p95Ms * 0.12))
      : Math.max(1, Math.round(baseP95 + j * baseP95 * 0.25));

    points.push({
      t: Math.round(t),
      errorRatePct: Number(errorRatePct.toFixed(2)),
      p95Ms,
      rps: Math.max(1, Math.round(180 + j * 40)),
    });
  }
  return points;
}

export function rawLogsFor(serviceId: string): string[] {
  return TELEMETRY_LOGS[serviceId] ?? [];
}

/** Where in the window the regression started, if it can be attributed. */
export function attributeRegression(
  points: TelemetryPoint[],
): { index: number; before: number; after: number } | null {
  if (points.length < 8) return null;
  let best: { index: number; before: number; after: number } | null = null;
  for (let i = 4; i < points.length - 3; i++) {
    const before = avg(points.slice(0, i).map((p) => p.errorRatePct));
    const after = avg(points.slice(i).map((p) => p.errorRatePct));
    const lift = after - before;
    if (lift > 0.5 && (!best || lift > best.after - best.before)) {
      best = { index: i, before: round(before), after: round(after) };
    }
  }
  return best;
}

const avg = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const round = (n: number): number => Number(n.toFixed(2));
