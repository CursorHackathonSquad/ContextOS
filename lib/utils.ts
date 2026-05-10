export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** Locale + UTC so SSR and browser match (same ms → same string regardless of server TZ). */
export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "UTC"
  });
}

