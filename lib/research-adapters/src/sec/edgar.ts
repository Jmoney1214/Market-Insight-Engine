/**
 * SEC EDGAR client — deterministic, fixture-friendly, fail-honest.
 *
 * Rules (SEC fair access + FinRobot pattern):
 * - a declared User-Agent is MANDATORY for live use (throws without one);
 * - requests are serialized with a minimum interval (default 110ms ≈ <10/s);
 * - filings are disk-cached by accession number — a document is fetched once;
 * - every fetched filing is emitted as a research-contracts SourceDocument
 *   (sourceClass PRIMARY_REGULATOR) with the raw SHA-256 recorded;
 * - no LLM anywhere: section extraction is regex/text (sections.ts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex, type SourceDocument } from "@workspace/research-contracts";
import { extractSections, htmlToText, type FilingSection } from "./sections";

export interface EdgarFilingRef {
  cik: string;
  accessionNumber: string;
  form: string;
  filingDate: string;
  acceptanceDateTime: string | null;
  primaryDocument: string;
  primaryDocDescription: string | null;
}

export interface EdgarClientOptions {
  /** e.g. "FinDesk research (ops@example.com)" — SEC requires identification. */
  userAgent?: string;
  cacheDir?: string;
  fetchFn?: typeof fetch;
  minIntervalMs?: number;
}

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";

export class EdgarClient {
  private readonly userAgent: string | undefined;
  private readonly cacheDir: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: EdgarClientOptions = {}) {
    this.userAgent = opts.userAgent ?? process.env["SEC_USER_AGENT"]?.trim() ?? undefined;
    this.cacheDir = opts.cacheDir;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 110;
  }

  /** Serialized, rate-limited GET returning body text, or null on failure. */
  private async get(url: string): Promise<string | null> {
    if (!this.userAgent) {
      throw new Error("EdgarClient: SEC_USER_AGENT (or options.userAgent) is required for live SEC access");
    }
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      try {
        const res = await this.fetchFn(url, {
          headers: { "user-agent": this.userAgent!, accept: "*/*" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private cachePath(...parts: string[]): string | null {
    if (!this.cacheDir) return null;
    // Filing documents may live in nested folders (e.g. "xsl144X01/primary_doc.xml"):
    // split every part on "/" so mkdir covers the whole tree, and drop traversal tokens.
    const segments = parts
      .flatMap((p) => p.split("/"))
      .filter((s) => s && s !== "." && s !== "..");
    if (segments.length === 0) return null;
    try {
      const dir = join(this.cacheDir, ...segments.slice(0, -1));
      mkdirSync(dir, { recursive: true });
      return join(dir, segments[segments.length - 1]!);
    } catch {
      return null; // cache is best-effort — never blocks a live fetch
    }
  }

  private cached(path: string | null): string | null {
    try {
      if (path && existsSync(path)) return readFileSync(path, "utf8");
    } catch {
      // fall through — a broken cache entry must not block a live fetch
    }
    return null;
  }

  private cacheWrite(path: string, body: string): void {
    try {
      writeFileSync(path, body);
    } catch {
      // cache is best-effort — never blocks evidence gathering
    }
  }

  static padCik(cik: string): string {
    return cik.replace(/^0+/, "").padStart(10, "0");
  }

  /** Symbol → padded CIK via the SEC ticker map (disk-cached); null when unknown. */
  async lookupCik(symbol: string): Promise<string | null> {
    const path = this.cachePath("meta", "company_tickers.json");
    let body = this.cached(path);
    if (body === null) {
      body = await this.get(TICKERS_URL);
      if (body !== null && path) this.cacheWrite(path, body);
    }
    if (body === null) return null;
    try {
      const rows = Object.values(JSON.parse(body) as Record<string, { cik_str: number; ticker: string }>);
      const hit = rows.find((r) => r.ticker?.toUpperCase() === symbol.toUpperCase());
      return hit ? EdgarClient.padCik(String(hit.cik_str)) : null;
    } catch {
      return null;
    }
  }

  /** Recent filings for a CIK from the submissions API (cached per day is caller's choice). */
  async getSubmissions(cik: string): Promise<EdgarFilingRef[] | null> {
    const padded = EdgarClient.padCik(cik);
    const body = await this.get(`${SUBMISSIONS_BASE}/CIK${padded}.json`);
    if (!body) return null;
    try {
      const data = JSON.parse(body) as {
        filings?: { recent?: Record<string, unknown[]> };
      };
      const r = data.filings?.recent;
      if (!r) return null;
      const n = (r["accessionNumber"] as string[] | undefined)?.length ?? 0;
      const out: EdgarFilingRef[] = [];
      for (let i = 0; i < n; i++) {
        out.push({
          cik: padded,
          accessionNumber: String((r["accessionNumber"] as string[])[i]),
          form: String((r["form"] as string[] | undefined)?.[i] ?? ""),
          filingDate: String((r["filingDate"] as string[] | undefined)?.[i] ?? ""),
          acceptanceDateTime: ((r["acceptanceDateTime"] as string[] | undefined)?.[i] as string | undefined) ?? null,
          primaryDocument: String((r["primaryDocument"] as string[] | undefined)?.[i] ?? ""),
          primaryDocDescription:
            ((r["primaryDocDescription"] as string[] | undefined)?.[i] as string | undefined) ?? null,
        });
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Raw primary document for a filing — disk-cached by accession. */
  async getFilingDocument(ref: Pick<EdgarFilingRef, "cik" | "accessionNumber" | "primaryDocument">): Promise<string | null> {
    const accession = ref.accessionNumber.replace(/-/g, "");
    const path = this.cachePath("filings", accession, ref.primaryDocument || "primary.html");
    const hit = this.cached(path);
    if (hit !== null) return hit;
    const cikNum = String(Number(ref.cik));
    const body = await this.get(`${ARCHIVES_BASE}/${cikNum}/${accession}/${ref.primaryDocument}`);
    if (body !== null && path) this.cacheWrite(path, body);
    return body;
  }

  /** Fetch + parse a filing into sections, with its SourceDocument evidence record. */
  async getFiling(ref: EdgarFilingRef, opts?: { symbols?: string[]; now?: string }): Promise<
    | { document: SourceDocument; sections: FilingSection[]; text: string }
    | null
  > {
    const html = await this.getFilingDocument(ref);
    if (html === null) return null;
    const text = htmlToText(html);
    const now = opts?.now ?? new Date().toISOString();
    const document: SourceDocument = {
      contract: "SourceDocument",
      version: "1.0.0",
      sourceDocumentId: `sec:${ref.accessionNumber}`,
      canonicalUrl: `${ARCHIVES_BASE}/${String(Number(ref.cik))}/${ref.accessionNumber.replace(/-/g, "")}/${ref.primaryDocument}`,
      providerDocumentId: ref.accessionNumber,
      publisher: "U.S. Securities and Exchange Commission",
      sourceClass: "PRIMARY_REGULATOR",
      documentType: `SEC_${ref.form.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`,
      symbols: opts?.symbols ?? [],
      publicationTime: ref.acceptanceDateTime,
      eventTime: null,
      firstKnownTime: ref.acceptanceDateTime,
      retrievedAt: now,
      asOf: now,
      rawSha256: `sha256:${sha256Hex(html)}`,
      contentStored: Boolean(this.cacheDir),
    };
    return { document, sections: extractSections(text), text };
  }
}
