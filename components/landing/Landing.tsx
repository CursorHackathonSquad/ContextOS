"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, SparkIcon } from "@/components/ui/icons";
import { CONTEXTOS_INPUT_KEY, TASK_INPUT_PLACEHOLDER } from "@/lib/session-input";
import { cx } from "@/lib/utils";

/** Slightly larger than the original 280px cap; min height bumped from 68px. */
const TASK_FIELD_MAX_PX = 300;

export function Landing() {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const taskFieldRef = React.useRef<HTMLTextAreaElement>(null);

  const syncTaskFieldHeight = React.useCallback(() => {
    const el = taskFieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, TASK_FIELD_MAX_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > TASK_FIELD_MAX_PX ? "auto" : "hidden";
  }, []);

  React.useLayoutEffect(() => {
    syncTaskFieldHeight();
  }, [text, syncTaskFieldHeight]);

  /** Drop any stale handoff keys so task text is never restored after refresh or server restart. */
  React.useEffect(() => {
    try {
      sessionStorage.removeItem(CONTEXTOS_INPUT_KEY);
      sessionStorage.removeItem("contextos_autorun");
    } catch {
      /* ignore */
    }
  }, []);

  function continueToRun() {
    try {
      sessionStorage.setItem(CONTEXTOS_INPUT_KEY, text);
      sessionStorage.setItem("contextos_autorun", "1");
    } catch {
      /* ignore */
    }
    router.push("/run");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className="flex shrink-0 items-center justify-center">
            <SparkIcon className="h-8 w-8 text-indigo-200" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">OsanoAI</h1>
        </div>

        <div className="relative w-full">
          <textarea
            ref={taskFieldRef}
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            className={cx(
              "hide-scrollbar min-h-[110px] max-h-[300px] w-full resize-none overflow-hidden rounded-xl border-0 bg-white/[0.1] px-4 py-4 pr-12 text-sm leading-relaxed text-zinc-100",
              "placeholder:text-zinc-300 placeholder:opacity-100 placeholder:leading-snug",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            )}
            placeholder={TASK_INPUT_PLACEHOLDER}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={continueToRun}
            aria-label="Run task"
            className={cx(
              "absolute right-3 top-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0",
              "bg-indigo-600 text-white",
              "transition hover:bg-indigo-500 active:bg-indigo-700",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/35"
            )}
          >
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
