"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { SparkIcon } from "@/components/ui/icons";
import { CONTEXTOS_INPUT_KEY } from "@/lib/session-input";
import { cx } from "@/lib/utils";

export function Landing() {
  const router = useRouter();
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(CONTEXTOS_INPUT_KEY);
      if (saved) setText(saved);
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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4 py-12 text-zinc-100">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-center gap-4">
          <div className="flex shrink-0 items-center justify-center">
            <SparkIcon className="h-8 w-8 text-indigo-200" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">OsanoAI</h1>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Task</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4 pt-0">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className={cx(
                "hide-scrollbar min-h-[120px] w-full resize-y rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm leading-relaxed",
                "placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              )}
              placeholder="Describe what you want done — context, goals, and constraints."
              autoComplete="off"
            />
            <Button variant="primary" size="sm" className="w-full" onClick={continueToRun}>
              Run task
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
