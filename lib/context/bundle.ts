import type { WorkerArtifact } from "@/lib/orchestrator/types";

/**
 * Builds the user message body for a worker from orchestrator-selected keys only.
 * Supported keys:
 * - `task` — original user task string
 * - `urls_fetched` — prefetched page text (if executor populated it)
 * - `artifact:<subtask_id>` — JSON output from a prior phase subtask
 */
export function buildContextMarkdown(
  keys: string[],
  task: string,
  artifacts: Record<string, WorkerArtifact>,
  urlsFetched: string
): string {
  const sections: string[] = [];

  for (const raw of keys) {
    const key = raw.trim();
    if (!key) continue;

    if (key === "task") {
      sections.push("## Task\n\n" + (task.trim() || "(empty)"));
      continue;
    }

    if (key === "urls_fetched") {
      sections.push(
        "## urls_fetched\n\n" +
          (urlsFetched.trim() ? urlsFetched.trim() : "(none — no URLs or fetch not run / empty)")
      );
      continue;
    }

    const artPrefix = "artifact:";
    if (key.startsWith(artPrefix)) {
      const id = key.slice(artPrefix.length).trim();
      const w = artifacts[id];
      const body = w
        ? `${w.summary}\n\n${typeof w.artifact === "object" && w.artifact !== null ? JSON.stringify(w.artifact, null, 2) : String(w.artifact ?? "")}`
        : "(artifact not available yet — check orchestrator dependencies)";
      sections.push(`## artifact:${id}\n\n${body}`);
      continue;
    }

    sections.push(`## ${key}\n\n(context key not recognized — omitted)`);
  }

  return sections.join("\n\n---\n\n");
}
