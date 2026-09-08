"use client";

import type { ReactNode } from "react";

/** Shared primitives. Hairlines and spacing do the work; nothing glows. */

export type Tone =
  | "neutral"
  | "human"
  | "agent"
  | "live"
  | "deny"
  | "warn"
  | "quiet";

const TONE_CHIP: Record<Tone, string> = {
  neutral: "border-rule-strong bg-sunken text-ink",
  human: "border-human/30 bg-human/8 text-human",
  agent: "border-agent/30 bg-agent/8 text-agent",
  live: "border-live/30 bg-live/8 text-live",
  deny: "border-deny/30 bg-deny/8 text-deny",
  warn: "border-warn/30 bg-warn/8 text-warn",
  quiet: "border-rule bg-transparent text-ink-faint",
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------- panel ---------------------------------- */

export function Panel({
  title,
  sub,
  meta,
  children,
  className,
  bodyClassName,
  action,
}: {
  title: string;
  /**
   * The precise term for what `title` says plainly. Plain words carry the
   * heading; the real vocabulary rides along underneath so a reviewer who
   * knows the spec can still map the UI onto it.
   */
  sub?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  action?: ReactNode;
}) {
  return (
    <section
      className={cx(
        "flex min-h-0 flex-col border border-rule bg-surface",
        className,
      )}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5">
        <h2 className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{title}</span>
          {sub ? <span className="label">{sub}</span> : null}
        </h2>
        <div className="flex items-center gap-2">
          {meta}
          {action}
        </div>
      </header>
      <div className={cx("min-h-0 flex-1", bodyClassName ?? "p-4")}>{children}</div>
    </section>
  );
}

/* ---------------------------------- chip ---------------------------------- */

export function Chip({
  tone = "neutral",
  children,
  mono = true,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        mono && "font-mono",
        TONE_CHIP[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  const bg: Record<Tone, string> = {
    neutral: "bg-ink",
    human: "bg-human",
    agent: "bg-agent",
    live: "bg-live",
    deny: "bg-deny",
    warn: "bg-warn",
    quiet: "bg-ink-faint",
  };
  return (
    <span
      aria-hidden
      className={cx("inline-block size-1.5 rounded-full", bg[tone], pulse && "pulse")}
    />
  );
}

/* --------------------------------- button --------------------------------- */

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "sm",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ink" | "human" | "deny" | "ghost";
  size?: "sm" | "xs";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = {
    sm: "px-3 py-1.5 text-[12px]",
    xs: "px-2 py-1 text-[11px]",
  };
  const variants = {
    ink: "border-ink bg-ink text-paper hover:bg-ink/85",
    human: "border-human bg-human text-white hover:bg-human/88",
    deny: "border-deny/40 bg-surface text-deny hover:bg-deny/8",
    ghost: "border-rule-strong bg-surface text-ink hover:bg-sunken",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(base, sizes[size], variants[variant])}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "w-full border border-rule-strong bg-surface px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-faint focus:border-human focus:outline-none";

/* ---------------------------------- misc ---------------------------------- */

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="border border-dashed border-rule px-3 py-6 text-center text-[12px] text-ink-faint">
      {children}
    </p>
  );
}

/** Countdown bar for a live grant. Reads as time, not as decoration. */
export function Countdown({
  remainingMs,
  totalMs,
}: {
  remainingMs: number;
  totalMs: number;
}) {
  const pct = totalMs > 0 ? Math.max(0, Math.min(100, (remainingMs / totalMs) * 100)) : 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const urgent = seconds <= 30;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative block h-1 w-14 bg-rule" aria-hidden>
        <span
          className={cx(
            "absolute inset-y-0 left-0 block transition-[width] duration-1000 ease-linear",
            urgent ? "bg-deny" : "bg-live",
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={cx("num text-[11px]", urgent ? "text-deny" : "text-ink-soft")}>
        {seconds}s
      </span>
    </span>
  );
}
