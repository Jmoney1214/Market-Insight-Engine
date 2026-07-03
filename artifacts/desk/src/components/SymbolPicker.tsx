import { useEffect, useState } from "react";

/** Symbols with bundled fixtures (the only ones REPLAY / FIXTURE support). */
export const FIXTURE_SYMBOLS = ["AAPL", "MSFT", "TSLA", "NODATA"] as const;

/** Mirrors the api-server symbol validation (BRK-B, BTC-USD, ^GSPC, ES=F, 7203.T). */
export const SYMBOL_PATTERN = /^[A-Z0-9.\-=^]{1,12}$/;

const SUGGESTED_SYMBOLS = [
  "AAPL",
  "MSFT",
  "TSLA",
  "NVDA",
  "AMD",
  "MU",
  "INTC",
  "META",
  "AMZN",
  "GOOGL",
  "SPY",
  "QQQ",
  "IWM",
  "COIN",
  "BTC-USD",
];

interface SymbolPickerProps {
  symbol: string;
  onChange: (symbol: string) => void;
  /** Restrict to fixture symbols (fixture source or replay mode). */
  restricted: boolean;
}

/**
 * Ticker selector. In fixture/replay contexts it stays a dropdown limited to
 * the bundled fixtures; on the live delayed feed it becomes a free-text input
 * so any Yahoo-supported ticker can be researched.
 */
export function SymbolPicker({ symbol, onChange, restricted }: SymbolPickerProps) {
  const [draft, setDraft] = useState(symbol);
  const [invalid, setInvalid] = useState(false);

  // Keep the draft in sync when the committed symbol changes externally
  // (e.g. auto-reset to AAPL when switching to fixtures).
  useEffect(() => {
    setDraft(symbol);
    setInvalid(false);
  }, [symbol]);

  const isFixture = (FIXTURE_SYMBOLS as readonly string[]).includes(symbol);

  // If we land in a restricted context (fixture source / replay) holding a
  // non-fixture symbol, COMMIT the fallback instead of merely displaying it,
  // so the store and UI never diverge.
  useEffect(() => {
    if (restricted && !isFixture) onChange(FIXTURE_SYMBOLS[0]);
  }, [restricted, isFixture, onChange]);

  if (restricted) {
    const value = isFixture ? symbol : FIXTURE_SYMBOLS[0];
    return (
      <select
        className="bg-card border border-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Symbol"
        title="Fixture symbols (switch source to DELAYED for any ticker)"
      >
        {FIXTURE_SYMBOLS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    const next = draft.toUpperCase().trim();
    if (!next || next === symbol) {
      setDraft(symbol);
      setInvalid(false);
      return;
    }
    if (!SYMBOL_PATTERN.test(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(next);
  };

  return (
    <>
      <input
        type="text"
        list="symbol-suggestions"
        className={`bg-card border rounded px-2 py-1 text-sm font-mono text-foreground w-28 uppercase focus:outline-none focus:ring-1 ${
          invalid
            ? "border-destructive focus:ring-destructive"
            : "border-border focus:ring-ring"
        }`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value.toUpperCase());
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(symbol);
            setInvalid(false);
          }
        }}
        onBlur={commit}
        aria-label="Symbol"
        aria-invalid={invalid}
        placeholder="TICKER"
        spellCheck={false}
        autoComplete="off"
        maxLength={12}
        title={
          invalid
            ? "Invalid ticker (letters, digits, . - = ^, max 12 chars)"
            : "Type any ticker and press Enter"
        }
      />
      <datalist id="symbol-suggestions">
        {SUGGESTED_SYMBOLS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
