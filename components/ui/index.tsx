"use client";

import * as React from "react";
import { cx } from "@/lib/utils";

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur",
        "hover:border-white/15 transition-colors",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("px-4 pt-4 pb-3", className)} {...rest} />;
}

export function CardTitle(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-3 text-sm font-semibold tracking-wide text-zinc-100",
        className
      )}
      {...rest}
    />
  );
}

export function CardBody(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("px-4 pb-4", className)} {...rest} />;
}

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
  }
) {
  const { className, variant = "secondary", size = "md", ...rest } = props;

  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "h-9 px-3" : "h-10 px-4";
  const variants = {
    primary:
      "border-indigo-400/20 bg-indigo-500/20 text-indigo-50 hover:bg-indigo-500/26 hover:border-indigo-400/25 shadow-[0_0_0_1px_rgba(99,102,241,0.15)]",
    secondary: "border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.06]",
    ghost: "border-transparent bg-transparent text-zinc-200 hover:bg-white/[0.05]",
    danger: "border-rose-400/20 bg-rose-500/15 text-rose-50 hover:bg-rose-500/20"
  } as const;

  return <button className={cx(base, sizes, variants[variant], className)} {...rest} />;
}

export const Select = React.forwardRef(function Select(
  { className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>,
  ref: React.ForwardedRef<HTMLSelectElement>
) {
  return (
    <div className="relative isolate min-w-0 w-full">
      <select
        ref={ref}
        className={cx(
          "h-10 w-full min-w-0 cursor-pointer appearance-none rounded-xl border border-white/15 bg-black/35 pl-3 pr-11 text-sm leading-snug text-zinc-100",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors",
          "hover:border-white/20 hover:bg-black/40",
          "focus:border-indigo-400/35 focus:outline-none focus:ring-2 focus:ring-indigo-500/35",
          "disabled:cursor-not-allowed disabled:opacity-40",
          "[&>option]:bg-zinc-900 [&>option]:text-zinc-100",
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <span
        className="pointer-events-none absolute inset-y-0 right-3 z-[1] flex w-5 shrink-0 items-center justify-center text-zinc-500"
        aria-hidden
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
});

/** Shared visual tokens for {@link Badge}, {@link Callout}, and related chips. */
export const BADGE_TONES = {
  neutral: "border-white/10 bg-white/[0.04] text-zinc-200",
  ok: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-400/20 bg-amber-500/10 text-amber-200",
  err: "border-rose-400/20 bg-rose-500/10 text-rose-200",
  info: "border-sky-400/20 bg-sky-500/10 text-sky-200"
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

const BADGE_SIZES = {
  compact: "rounded-lg px-2 py-0.5 text-[11px]",
  md: "shrink-0 items-center rounded-lg border px-2 py-px text-xs font-medium leading-none"
} as const;

export type BadgeSize = keyof typeof BADGE_SIZES;

export function badgeSurface(tone: BadgeTone, size: BadgeSize) {
  return cx("inline-flex items-center border font-medium", BADGE_TONES[tone], BADGE_SIZES[size]);
}

export function Badge({
  tone = "neutral",
  size = "compact",
  className,
  children
}: {
  tone?: BadgeTone;
  /** `md` — toolbar chips: shorter than `Button sm`, smaller type than the Input label. */
  size?: BadgeSize;
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cx(badgeSurface(tone, size), className)}>{children}</span>;
}

/** Interactive chip strip (e.g. agent row): same scale as badges, selection uses indigo like primary actions. */
const CHIP_SHELL =
  "flex min-h-[2.25rem] w-max max-w-[min(28rem,calc(100vw-2rem))] flex-nowrap items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[13px] font-semibold leading-none text-zinc-100 transition";

const CHIP_TRAY = {
  idle: "border-white/10 bg-black/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:border-white/18 hover:bg-black/45",
  selected:
    "border-indigo-400/45 bg-indigo-500/15 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
} as const;

/** Non-interactive chip shell — matches idle {@link Chip} visuals (counts, toolbar meta). */
export function ChipMeta({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        CHIP_SHELL,
        "border-white/10 bg-black/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export const Chip = React.forwardRef(function Chip(
  {
    selected,
    className,
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean },
  ref: React.ForwardedRef<HTMLButtonElement>
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        CHIP_SHELL,
        "text-left focus:outline-none focus:ring-2 focus:ring-indigo-500/35",
        selected ? CHIP_TRAY.selected : CHIP_TRAY.idle,
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Block notice using the same tones as {@link Badge} (multi-line copy). */
export function Callout({
  tone = "warn",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: BadgeTone }) {
  return (
    <div className={cx("rounded-lg border px-3 py-2 text-[11px] font-normal leading-relaxed", BADGE_TONES[tone], className)} {...rest}>
      {children}
    </div>
  );
}

/** Dashed empty region (e.g. no agents yet). */
export function EmptyWell({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-xl border border-dashed border-white/15 bg-black/25 px-4 py-10 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]",
        className
      )}
      {...rest}
    />
  );
}

/** Inset detail panel (pinned agent, etc.). */
export function InsetPanel({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-xl border border-white/10 bg-black/35 p-4 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
        className
      )}
      {...rest}
    />
  );
}

/** Neutral list row (handoffs, meta rows) — same border/bg language as chips. */
export function PanelRow({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs",
        className
      )}
      {...rest}
    />
  );
}
