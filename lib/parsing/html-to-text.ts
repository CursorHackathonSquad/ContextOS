/** Best-effort HTML → plain text for LLM consumption (not a full DOM parser). */
export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  s = s.replace(/<\/(p|div|br|tr|h[1-6]|li|blockquote)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/\s+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}
