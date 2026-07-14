import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentManifest, SourceDocument } from "@workspace/research-contracts";
import { extractSections, htmlToText } from "./sec/sections";
import { EdgarClient } from "./sec/edgar";
import { parseRedditListing } from "./social/reddit";
import { parseXRecentSearch } from "./social/x";
import { RedditAdapter } from "./social/reddit";
import { XAdapter } from "./social/x";
import { extractCashtag } from "./social/attention";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- manifests: every Wave-1 agent loads under the 2026 rules ---------------
describe("wave-1 agent manifests", () => {
  const dir = join(HERE, "..", "manifests");
  for (const file of readdirSync(dir)) {
    it(`${file} validates (deterministic: zero model calls)`, () => {
      const { manifest, manifestHash } = loadAgentManifest(readFileSync(join(dir, file), "utf8"));
      expect(manifest.model_policy.tier).toBe("none");
      expect(manifest.budgets.maximum_model_calls).toBe(0);
      expect(manifestHash).toMatch(/^sha256:/);
    });
  }
});

// ---- SEC sections ------------------------------------------------------------
const EIGHT_K_HTML = `
<html><body>
<p>TABLE OF CONTENTS</p>
<p>Item 5.02 Departure of Directors</p>
<p>Item 8.01 Other Events</p>
<h2>Item 5.02. Departure of Directors or Certain Officers</h2>
<p>On July 10, 2026, the Company announced that its CFO resigned effective immediately.</p>
<h2>Item 8.01. Other Events</h2>
<p>The Company also announced a $50 million contract award from a government agency.</p>
</body></html>`;

describe("SEC section extraction", () => {
  it("strips html and splits items, keeping the body occurrence over the TOC", () => {
    const sections = extractSections(htmlToText(EIGHT_K_HTML));
    const items = sections.map((s) => s.item);
    expect(items).toEqual(["ITEM 5.02", "ITEM 8.01"]);
    expect(sections[0]!.text).toContain("CFO resigned");
    expect(sections[1]!.text).toContain("$50 million contract award");
    // TOC line must not have swallowed the body.
    expect(sections[0]!.text).not.toContain("Other Events");
  });

  it("returns [] when no item headings exist", () => {
    expect(extractSections("just a press release with no items")).toEqual([]);
  });
});

// ---- EdgarClient (injected fetch — no network) ---------------------------------
const SUBMISSIONS_FIXTURE = JSON.stringify({
  filings: {
    recent: {
      accessionNumber: ["0001838359-26-000042"],
      form: ["8-K"],
      filingDate: ["2026-07-10"],
      acceptanceDateTime: ["2026-07-10T08:31:12-04:00"],
      primaryDocument: ["rgti-8k.htm"],
      primaryDocDescription: ["8-K"],
    },
  },
});

function fakeFetch(bodyByUrlPart: Record<string, string>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = String(url);
    const hit = Object.entries(bodyByUrlPart).find(([part]) => u.includes(part));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(hit[1], { status: 200 });
  }) as typeof fetch;
}

describe("EdgarClient", () => {
  it("requires a user agent for live access", async () => {
    const c = new EdgarClient({ userAgent: undefined, fetchFn: fakeFetch({}) });
    // Force: no env fallback in this test
    if (!process.env["SEC_USER_AGENT"]) {
      await expect(c.getSubmissions("1838359")).rejects.toThrow(/SEC_USER_AGENT/);
    }
  });

  it("parses submissions and emits a PRIMARY_REGULATOR SourceDocument with sections", async () => {
    const cache = mkdtempSync(join(tmpdir(), "edgar-"));
    const c = new EdgarClient({
      userAgent: "test-suite (test@example.com)",
      cacheDir: cache,
      minIntervalMs: 0,
      fetchFn: fakeFetch({ "data.sec.gov/submissions": SUBMISSIONS_FIXTURE, "Archives/edgar/data": EIGHT_K_HTML }),
    });
    const subs = await c.getSubmissions("1838359");
    expect(subs).not.toBeNull();
    expect(subs![0]!.form).toBe("8-K");
    const filing = await c.getFiling(subs![0]!, { symbols: ["RGTI"], now: "2026-07-13T09:00:00-04:00" });
    expect(filing).not.toBeNull();
    expect(SourceDocument.safeParse(filing!.document).success).toBe(true);
    expect(filing!.document.sourceClass).toBe("PRIMARY_REGULATOR");
    expect(filing!.document.documentType).toBe("SEC_8_K");
    expect(filing!.document.rawSha256).toMatch(/^sha256:/);
    expect(filing!.sections.map((s) => s.item)).toContain("ITEM 8.01");
  });

  it("serves the document from disk cache on the second read (one fetch only)", async () => {
    const cache = mkdtempSync(join(tmpdir(), "edgar-"));
    let hits = 0;
    const counting = (async (url: RequestInfo | URL) => {
      hits++;
      return new Response(EIGHT_K_HTML, { status: 200 });
    }) as typeof fetch;
    const c = new EdgarClient({ userAgent: "t (t@e.com)", cacheDir: cache, minIntervalMs: 0, fetchFn: counting });
    const ref = { cik: "0001838359", accessionNumber: "0001838359-26-000042", primaryDocument: "doc.htm" };
    await c.getFilingDocument(ref);
    await c.getFilingDocument(ref);
    expect(hits).toBe(1);
  });

  it("caches documents whose primaryDocument lives in a nested folder (Form 144 style)", async () => {
    // Regression: "xsl144X01/primary_doc.xml" used to ENOENT on cache write and
    // kill the whole evidence gather.
    const cache = mkdtempSync(join(tmpdir(), "edgar-"));
    let hits = 0;
    const counting = (async () => {
      hits++;
      return new Response(EIGHT_K_HTML, { status: 200 });
    }) as typeof fetch;
    const c = new EdgarClient({ userAgent: "t (t@e.com)", cacheDir: cache, minIntervalMs: 0, fetchFn: counting });
    const ref = { cik: "0001838359", accessionNumber: "0001967940-26-000033", primaryDocument: "xsl144X01/primary_doc.xml" };
    const first = await c.getFilingDocument(ref);
    expect(first).toBe(EIGHT_K_HTML);
    const second = await c.getFilingDocument(ref);
    expect(second).toBe(EIGHT_K_HTML);
    expect(hits).toBe(1);
  });

  it("a traversal-shaped primaryDocument cannot escape the cache dir", async () => {
    const cache = mkdtempSync(join(tmpdir(), "edgar-"));
    const c = new EdgarClient({
      userAgent: "t (t@e.com)",
      cacheDir: cache,
      minIntervalMs: 0,
      fetchFn: fakeFetch({ "Archives/edgar/data": EIGHT_K_HTML }),
    });
    const ref = { cik: "0001838359", accessionNumber: "0001967940-26-000033", primaryDocument: "../../escape.htm" };
    await c.getFilingDocument(ref);
    expect(existsSync(join(cache, "..", "..", "escape.htm"))).toBe(false);
    expect(existsSync(join(cache, "filings", "000196794026000033", "escape.htm"))).toBe(true);
  });
});

// ---- social adapters -----------------------------------------------------------
describe("social adapters (fixture-first)", () => {
  it("normalizes a reddit listing into AttentionSignals with cashtags", () => {
    const listing = {
      data: {
        children: [
          { data: { id: "abc", title: "$RGTI contract confirmed?", permalink: "/r/x/abc", author: "u1", score: 42, created_utc: 1780000000 } },
          { data: { id: "def", title: "no tag here", author: "u2", score: 1, created_utc: 1780000001 } },
        ],
      },
    };
    const out = parseRedditListing(listing, "2026-07-13T09:00:00-04:00");
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("REDDIT");
    expect(out[0]!.symbol).toBe("RGTI");
    expect(out[0]!.engagement).toBe(42);
    expect(out[1]!.symbol).toBeNull();
  });

  it("normalizes an X recent-search response", () => {
    const json = {
      data: [
        { id: "1", text: "$SOFI breaking out", created_at: "2026-07-13T12:00:00Z", public_metrics: { like_count: 5, retweet_count: 2 } },
      ],
    };
    const out = parseXRecentSearch(json, "2026-07-13T09:00:00-04:00");
    expect(out[0]!.kind).toBe("X");
    expect(out[0]!.symbol).toBe("SOFI");
    expect(out[0]!.engagement).toBe(7);
  });

  it("returns null when unconfigured — never fabricates", async () => {
    const reddit = new RedditAdapter({ clientId: undefined, clientSecret: undefined, allowPublic: false, fetchFn: fakeFetch({}) });
    const x = new XAdapter({ bearerToken: undefined, fetchFn: fakeFetch({}) });
    expect(reddit.configured).toBe(false);
    expect(await reddit.search("RGTI")).toBeNull();
    expect(x.configured).toBe(false);
    expect(await x.search("RGTI")).toBeNull();
  });

  it("extracts cashtags case-insensitively, rejects overlong", () => {
    expect(extractCashtag("watch $rgti today")).toBe("RGTI");
    expect(extractCashtag("$TOOLONG1 nope")).toBeNull();
    expect(extractCashtag("no tag")).toBeNull();
  });
});
