"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/utils";

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return (
    <div
      className={cx(
        "rounded-2xl border border-white/10 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur",
        "transition-colors",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className, ...rest } = props;
  return <div className={cx("px-4 pt-4 pb-4", className)} {...rest} />;
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
  return <div className={cx("p-4 pt-0", className)} {...rest} />;
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
      "border-indigo-400/20 bg-indigo-500/20 text-indigo-50 hover:bg-indigo-500/26 shadow-[0_0_0_1px_rgba(99,102,241,0.15)]",
    secondary: "border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/[0.06]",
    ghost: "border-transparent bg-transparent text-zinc-200 hover:bg-white/[0.05]",
    danger: "border-rose-400/20 bg-rose-500/15 text-rose-50 hover:bg-rose-500/20"
  } as const;

  return <button className={cx(base, sizes, variants[variant], className)} {...rest} />;
}

const SELECT_TRIGGER =
  "h-10 w-full min-w-0 rounded-xl border border-white/15 bg-black/35 pl-3 pr-11 text-left text-sm leading-snug text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-black/40 focus:border-indigo-400/35 focus:outline-none focus:ring-2 focus:ring-indigo-500/35 disabled:cursor-not-allowed disabled:opacity-40";

function flattenOptionLabel(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenOptionLabel).join("");
  return "";
}

function parseSelectOptions(children: React.ReactNode): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") return;
    const p = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const value = p.value != null ? String(p.value) : "";
    const label = flattenOptionLabel(p.children).trim() || value;
    out.push({ value, label });
  });
  return out;
}

export const Select = React.forwardRef(function Select(
  {
    className,
    children,
    value,
    defaultValue,
    onChange,
    disabled,
    id,
    name,
    title,
    autoFocus,
    required: _required,
    ..._rest
  }: React.SelectHTMLAttributes<HTMLSelectElement>,
  ref: React.ForwardedRef<HTMLButtonElement>
) {
  const options = React.useMemo(() => parseSelectOptions(children), [children]);
  const [uncontrolled, setUncontrolled] = React.useState(String(defaultValue ?? ""));
  const isControlled = value !== undefined;
  const current = isControlled ? String(value ?? "") : uncontrolled;

  const selected = options.find((o) => o.value === current) ?? options[0];
  const label = selected?.label ?? "";

  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = React.useState({ top: 0, left: 0, width: 0 });

  React.useEffect(() => setMounted(true), []);

  const updateMenuPos = React.useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    const onResizeOrScroll = () => updateMenuPos();
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open, updateMenuPos]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: string) {
    if (!isControlled) setUncontrolled(next);
    const ev = {
      target: { value: next },
      currentTarget: { value: next }
    } as React.ChangeEvent<HTMLSelectElement>;
    onChange?.(ev);
    setOpen(false);
  }

  const dropdown = open ? (
    <div
      ref={listRef}
      role="listbox"
      className={cx(
        "hide-scrollbar fixed z-[300] max-h-60 overflow-y-auto rounded-xl border border-white/15 bg-zinc-950 py-0.5",
        "shadow-[0_16px_48px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.06] backdrop-blur-md"
      )}
      style={{ top: menuPos.top, left: menuPos.left, width: Math.max(menuPos.width, 160) }}
    >
      {options.map((opt, i) => (
        <button
          key={`${opt.value}-${i}`}
          type="button"
          role="option"
          aria-selected={opt.value === current}
          className={cx(
            "flex w-full items-center px-3 py-1.5 text-left text-sm leading-snug transition",
            opt.value === current
              ? "bg-indigo-500/15 text-indigo-100"
              : "text-zinc-100 hover:bg-white/[0.06] active:bg-white/[0.08]"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => pick(opt.value)}
        >
          <span className="min-w-0 truncate">{opt.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div ref={wrapRef} className="relative isolate min-w-0 w-full">
      {/* Preserve native select name for forms / hydration consistency */}
      {name ? <input type="hidden" name={name} value={current} readOnly aria-hidden /> : null}
      <button
        ref={(node) => {
          (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = node;
          if (typeof ref === "function") ref(node);
          else if (ref && typeof ref === "object") (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        }}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(SELECT_TRIGGER, className)}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="block min-w-0 truncate pr-1">{label}</span>
      </button>
      <span
        className={cx(
          "pointer-events-none absolute inset-y-0 right-3 z-[1] flex w-5 shrink-0 items-center justify-center text-zinc-500 transition-transform duration-200",
          open && "rotate-180"
        )}
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
      {mounted && dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
});

/** Shared visual tokens for {@link Badge}, {@link Callout}, and related chips. */
export const BADGE_TONES = {
  neutral: "border-white/10 bg-white/[0.04] text-zinc-200",
  ok: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-400/20 bg-amber-500/10 text-amber-200",
  err: "border-rose-400/20 bg-rose-500/10 text-rose-200",
  info: "border-sky-400/20 bg-sky-500/10 text-sky-200",
  /** Needs review — distinct from amber “running” */
  review: "border-fuchsia-400/25 bg-fuchsia-500/12 text-fuchsia-100"
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

const BADGE_SIZES = {
  compact: "rounded-lg px-2 py-0.5 text-[11px]",
  md: "shrink-0 items-center rounded-lg border px-2 py-0.5 text-xs font-medium leading-none"
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
  idle: "border-white/10 bg-black/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] hover:bg-black/45",
  selected:
    "border-indigo-400/45 bg-indigo-500/15 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.12)]"
} as const;

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
        "rounded-xl border border-dashed border-white/15 bg-black/25 px-4 py-5 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]",
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
        "flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs",
        className
      )}
      {...rest}
    />
  );
}
