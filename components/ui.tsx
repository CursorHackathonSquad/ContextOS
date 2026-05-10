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

export function Badge({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "ok" | "warn" | "err" | "info";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-white/10 bg-white/[0.04] text-zinc-200",
    ok: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-400/20 bg-amber-500/10 text-amber-200",
    err: "border-rose-400/20 bg-rose-500/10 text-rose-200",
    info: "border-sky-400/20 bg-sky-500/10 text-sky-200"
  } as const;

  return (
    <span className={cx("inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-zinc-300">
      {children}
    </span>
  );
}

