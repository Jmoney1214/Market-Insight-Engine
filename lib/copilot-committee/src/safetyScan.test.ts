// Automated "no execution code" safety scan (spec §21 items 14, 15, 16; §22).
//
// This is the executable form of the spec's forbidden-grep: it walks the actual
// product source (lib/ + artifacts/) and asserts that no broker-execution,
// order-routing, simulated-exchange, paper-trading, or trade-approval code
// exists anywhere — and that no broker/exchange SDK is declared in any manifest.
//
// The ONE legitimate definition site of these identifiers is the committee's own
// ban-list (vocab.ts), which is excluded along with test files and build output.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

function repoRoot(): string {
  let dir = dirname(SELF);
  for (let i = 0; i < 12; i++) {
    try {
      statSync(join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      /* keep walking up */
    }
    dir = dirname(dir);
  }
  throw new Error("repo root (pnpm-workspace.yaml) not found");
}

const ROOT = repoRoot();
const SCAN_DIRS = ["lib", "artifacts"];
const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  "build",
  ".turbo",
  ".vite",
  "coverage",
  ".replit-artifact",
]);

function walk(
  dir: string,
  match: (name: string) => boolean,
  out: string[] = [],
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIR.has(name)) continue;
      walk(full, match, out);
    } else if (match(name)) {
      out.push(full);
    }
  }
  return out;
}

const isSourceFile = (name: string): boolean =>
  /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name);
const isVocab = (path: string): boolean => path.endsWith("/vocab.ts");

// Lowercased substring tokens that must never appear in product source. Covers
// snake_case + camelCase + spaced execution identifiers, simulated-exchange /
// paper-order forms, trade-approval phrasing, and broker SDK names. None of
// these collide with the project's safety disclaimers ("never executes,
// simulates, routes, or paper-trades") or the benign "paper_validated" edge
// validation status, which use different punctuation.
const FORBIDDEN_TOKENS: readonly string[] = [
  // order / execution identifiers
  "submit_order",
  "submitorder",
  "place_order",
  "placeorder",
  "execute_trade",
  "executetrade",
  "fill_order",
  "fillorder",
  // simulated / paper execution surfaces
  "simulated exchange",
  "simulatedexchange",
  "exchange simulator",
  "exchangesimulator",
  "paper order",
  "paperorder",
  "papertrade",
  "papertrading",
  "auto-trading",
  "autotrading",
  // approval workflows
  "transaction approval",
  "portfolio manager approval",
  "portfoliomanagerapproval",
  // broker / exchange SDKs
  "brokerclient",
  "brokerapi",
  "brokerage",
  "alpaca",
  "tradier",
  "robinhood",
  "webull",
  "ccxt",
  "interactive brokers",
  "ibkr",
];

// Broker / exchange SDK package-name fragments that must never appear as a
// dependency in any manifest.
const FORBIDDEN_DEP_FRAGMENTS: readonly RegExp[] = [
  /alpaca/i,
  /tradier/i,
  /ccxt/i,
  /robinhood/i,
  /webull/i,
  /ibkr/i,
  /interactive-?brokers/i,
];

describe("safety scan: no execution / broker / simulated-exchange code (items 14-16)", () => {
  const sourceFiles = SCAN_DIRS.flatMap((d) =>
    walk(join(ROOT, d), isSourceFile),
  ).filter((p) => p !== SELF && !isVocab(p));

  it("finds product source files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it("contains zero execution / broker / paper-trading identifiers", () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const token of FORBIDDEN_TOKENS) {
        if (text.includes(token)) {
          violations.push(`${file.slice(ROOT.length + 1)} :: "${token}"`);
        }
      }
    }
    expect(violations, `forbidden execution code found:\n${violations.join("\n")}`).toEqual([]);
  });

  it("declares no broker / exchange SDK in any manifest", () => {
    const manifests = SCAN_DIRS.flatMap((d) =>
      walk(join(ROOT, d), (name) => name === "package.json"),
    );
    expect(manifests.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of manifests) {
      let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      try {
        pkg = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      const deps = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
      for (const dep of deps) {
        if (FORBIDDEN_DEP_FRAGMENTS.some((re) => re.test(dep))) {
          violations.push(`${file.slice(ROOT.length + 1)} :: ${dep}`);
        }
      }
    }
    expect(violations, `broker SDK dependency found:\n${violations.join("\n")}`).toEqual([]);
  });
});
