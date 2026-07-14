/**
 * Deterministic SEC filing section extraction (FinRobot pattern, no LLM).
 * Strips HTML to text, then splits on the standard Item headings used by
 * 8-K ("Item 5.02") and 10-K/10-Q ("Item 1A") filings.
 */

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export interface FilingSection {
  /** Normalized heading, e.g. "ITEM 5.02" or "ITEM 1A". */
  item: string;
  title: string;
  text: string;
}

// 8-K items look like "Item 5.02"; 10-K/Q items like "Item 1A." / "Item 7".
const ITEM_HEADING = /(^|\n)\s*(item\s+(\d+(?:\.\d+)?[a-z]?))\s*[.:–—-]?\s*([^\n]*)/gi;

/** Split filing text into Item sections. Returns [] when no headings found. */
export function extractSections(text: string): FilingSection[] {
  const matches: Array<{ item: string; title: string; start: number; bodyStart: number }> = [];
  for (const m of text.matchAll(ITEM_HEADING)) {
    const item = `ITEM ${m[3]!.toUpperCase()}`;
    // Skip table-of-contents style repeats: keep the LAST occurrence of each
    // item heading (the body), matching how EDGAR filings order TOC-first.
    matches.push({
      item,
      title: (m[4] ?? "").trim().slice(0, 200),
      start: m.index ?? 0,
      bodyStart: (m.index ?? 0) + m[0].length,
    });
  }
  if (matches.length === 0) return [];

  const lastByItem = new Map<string, number>();
  matches.forEach((m, i) => lastByItem.set(m.item, i));
  const kept = matches.filter((m, i) => lastByItem.get(m.item) === i).sort((a, b) => a.start - b.start);

  return kept.map((m, i) => {
    const end = i + 1 < kept.length ? kept[i + 1]!.start : text.length;
    return { item: m.item, title: m.title, text: text.slice(m.bodyStart, end).trim().slice(0, 20000) };
  });
}
