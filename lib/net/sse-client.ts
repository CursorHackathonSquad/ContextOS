/**
 * Minimal SSE reader for browser fetch streams (one JSON payload per event).
 */
export async function consumeSseJson(
  response: Response,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);

      let ev = "message";
      let dataLine = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine = line.slice(5).trimStart();
      }
      if (!dataLine) continue;
      try {
        onEvent(ev, JSON.parse(dataLine));
      } catch {
        onEvent(ev, dataLine);
      }
    }
  }
}
