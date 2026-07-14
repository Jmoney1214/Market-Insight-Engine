/**
 * IPO / Dilution Analyst — a deterministic lifecycle router decides WHETHER
 * capital-structure diligence is required (recent IPO / SPAC / offering /
 * active shelf), and a deterministic extractor builds the CapitalStructure
 * from SEC filing text. Share/float numbers extracted from prose are ALWAYS
 * labeled ESTIMATED with the extraction method; anything unextractable is a
 * per-field UNKNOWN — never a guess.
 */
import type { CapitalStructure, UnknownField } from "@workspace/research-contracts";

export interface FilingSummary {
  form: string;
  accessionNumber: string;
  acceptedAt: string | null;
  sourceDocumentId: string;
  /** Plain text of the filing (or its cover/front section). */
  text: string;
}

export interface LifecycleInput {
  now: string;
  /** First trading day, null when unknown. */
  listingDate: string | null;
  forms: Array<{ form: string; acceptedAt: string | null }>;
  knownSpac?: boolean;
  ipoWindowDays?: number;
  offeringLookbackDays?: number;
}

export interface LifecycleDecision {
  lifecycleType: CapitalStructure["lifecycleType"];
  shouldRun: boolean;
  reasonCodes: string[];
}

function daysAgo(iso: string, now: string): number {
  return (new Date(now).getTime() - new Date(iso).getTime()) / 86_400_000;
}

const OFFERING_FORMS = /^424B\d?$/i;
const SHELF_FORMS = /^S-3/i;
const IPO_FORMS = /^(S-1|F-1)/i;

export function classifyLifecycle(input: LifecycleInput): LifecycleDecision {
  const ipoWindow = input.ipoWindowDays ?? 180;
  const lookback = input.offeringLookbackDays ?? 365;
  const reasons: string[] = [];

  const recent = (acceptedAt: string | null) =>
    acceptedAt != null && daysAgo(acceptedAt, input.now) <= lookback;

  const recentIpo =
    input.listingDate != null && daysAgo(input.listingDate, input.now) <= ipoWindow;
  const hasIpoForm = input.forms.some((f) => IPO_FORMS.test(f.form) && recent(f.acceptedAt));
  const hasOffering = input.forms.some((f) => OFFERING_FORMS.test(f.form) && recent(f.acceptedAt));
  const hasShelf = input.forms.some((f) => SHELF_FORMS.test(f.form) && recent(f.acceptedAt));

  if (recentIpo) reasons.push("LISTED_WITHIN_IPO_WINDOW");
  if (hasIpoForm) reasons.push("RECENT_REGISTRATION_STATEMENT");
  if (hasOffering) reasons.push("RECENT_OFFERING_PROSPECTUS");
  if (hasShelf) reasons.push("ACTIVE_SHELF_REGISTRATION");
  if (input.knownSpac) reasons.push("KNOWN_SPAC");

  let lifecycleType: CapitalStructure["lifecycleType"] = "MATURE";
  if (input.knownSpac) lifecycleType = recentIpo ? "SPAC" : "DE_SPAC";
  else if (recentIpo || hasIpoForm) lifecycleType = "RECENT_IPO";
  else if (hasOffering) lifecycleType = "FOLLOW_ON_OFFERING";
  else if (hasShelf) lifecycleType = "ACTIVE_SHELF";
  else if (input.listingDate == null && input.forms.length === 0) lifecycleType = "UNKNOWN";

  return { lifecycleType, shouldRun: reasons.length > 0, reasonCodes: reasons };
}

/**
 * Extracts a shares-outstanding figure from cover-page style prose, e.g.
 * "123,456,789 shares of common stock outstanding". Returns null when no
 * unambiguous match exists — never guesses.
 */
export function extractSharesOutstanding(text: string): number | null {
  const re = /([\d,]{4,})\s+shares?\s+of\s+(?:the\s+)?(?:registrant'?s?\s+)?common\s+stock[^.]{0,80}?outstanding/gi;
  const matches = [...text.matchAll(re)]
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0]! : null;
}

export interface BuildCapitalStructureInput {
  diligenceId: string;
  symbol: string;
  lifecycle: LifecycleDecision;
  filings: FilingSummary[];
  now: string;
}

export function buildCapitalStructure(input: BuildCapitalStructureInput): CapitalStructure {
  const unknownFields: UnknownField[] = [];
  const attempted = input.filings.map((f) => f.sourceDocumentId);

  // Prefer the most recently accepted filing that yields an extraction.
  const ordered = [...input.filings].sort((a, b) =>
    (b.acceptedAt ?? "").localeCompare(a.acceptedAt ?? ""),
  );
  let shares: number | null = null;
  for (const filing of ordered) {
    shares = extractSharesOutstanding(filing.text);
    if (shares != null) break;
  }

  const sharesOutstanding: CapitalStructure["sharesOutstanding"] =
    shares != null
      ? { value: shares, status: "ESTIMATED", method: "REGEX_COVER_PAGE_EXTRACTION", claimId: null }
      : { value: null, status: "UNKNOWN", method: null, claimId: null };
  if (shares == null) {
    unknownFields.push({
      path: "/sharesOutstanding/value",
      reasonCode: "NO_UNAMBIGUOUS_COVER_PAGE_FIGURE",
      attemptedSourceIds: attempted,
      blocking: false,
    });
  }

  // Tradable float requires holdings data this agent does not have; always
  // UNKNOWN here rather than a fabricated discount off shares outstanding.
  unknownFields.push({
    path: "/estimatedTradableFloat/value",
    reasonCode: "FLOAT_REQUIRES_HOLDINGS_DATA",
    attemptedSourceIds: attempted,
    blocking: false,
  });

  return {
    contract: "CapitalStructure",
    version: "1.0.0",
    diligenceId: input.diligenceId,
    symbol: input.symbol,
    lifecycleType: input.lifecycle.lifecycleType,
    filings: input.filings.map((f) => ({
      form: f.form,
      accessionNumber: f.accessionNumber,
      acceptedAt: f.acceptedAt,
      sourceDocumentId: f.sourceDocumentId,
    })),
    sharesOutstanding,
    estimatedTradableFloat: { value: null, status: "UNKNOWN", method: null, claimId: null },
    offeringPrice: { value: null, status: "NOT_APPLICABLE", method: null, claimId: null },
    lockupTerms: [],
    warrantsAndConvertibles: [],
    dilutionEvents: [],
    unknownFields,
    asOf: input.now,
  };
}
