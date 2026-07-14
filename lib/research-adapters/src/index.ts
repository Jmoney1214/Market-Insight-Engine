// Public API for the research data adapters (deterministic, no LLM).
export { EdgarClient, type EdgarFilingRef, type EdgarClientOptions } from "./sec/edgar";
export { extractSections, htmlToText, type FilingSection } from "./sec/sections";
export { RedditAdapter, parseRedditListing, type RedditOptions } from "./social/reddit";
export { XAdapter, parseXRecentSearch, type XOptions } from "./social/x";
export { extractCashtag, type AttentionSignal } from "./social/attention";
