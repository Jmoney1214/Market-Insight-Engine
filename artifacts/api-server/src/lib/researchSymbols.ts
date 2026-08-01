const RESERVED_RESEARCH_PATHS = new Set(["ACCURACY"]);

export function isRankableResearchSymbol(symbol: string): boolean {
  const normalized = symbol.toUpperCase().trim();
  return (
    /^[A-Z0-9.\-]{1,12}$/.test(normalized) &&
    !RESERVED_RESEARCH_PATHS.has(normalized)
  );
}
