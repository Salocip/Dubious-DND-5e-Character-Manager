#!/usr/bin/env node
// verify-audit.mjs : ground the PHB gap audit report.
// Zero dependencies. Node 16+.
//
// Verifies three things about docs/phb/audit-gaps.md:
//   G1  every PHB source section referenced exists in docs/phb/
//   G2  every app evidence symbol referenced exists in main.html
//   G3  the report's "Missing" claims hold: the app lacks the named features
//       (negative control, self-tested against a known-present symbol)
//
// Prints "audit verification passed" only after every assertion passes.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = join(root, "docs", "phb", "audit-gaps.md");
const appPath = join(root, "main.html");
const phbDir = join(root, "docs", "phb");

const report = readFileSync(reportPath, "utf8");
const app = readFileSync(appPath, "utf8");

const failures = [];
const ok = (msg) => console.log("  ok  " + msg);
const fail = (msg) => failures.push(msg);

// ---- G1: every PHB source section referenced exists in docs/phb/ ----
const phbRefs = [...report.matchAll(/`(\d{2}-[a-z0-9-]+\.md)`/g)].map((m) => m[1]);
const uniqueRefs = [...new Set(phbRefs)];
if (!uniqueRefs.length) fail("G1: no PHB section references found in report");
for (const ref of uniqueRefs) {
  if (existsSync(join(phbDir, ref))) ok("G1: PHB section exists: " + ref);
  else fail("G1: PHB section missing: " + ref);
}

// ---- G2: every app evidence symbol referenced exists in main.html ----
// Symbols are the backticked tokens in the App evidence column. We extract
// tokens that look like code (contain parens, dots, or are camelCase/known ids).
const appEvidence = report
  .split("\n")
  .filter((l) => l.includes("|") && l.includes("main.html"))
  .map((l) => l.split("|")[5] || "") // App evidence column (6 pipe fields)
  .join("\n");
const symbolRefs = [...appEvidence.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const uniqueSymbols = [...new Set(symbolRefs)];
if (!uniqueSymbols.length) fail("G2: no app evidence symbols found in report");
for (const sym of uniqueSymbols) {
  // Strip a trailing line/range like ":1106" or ":219-222" for the search.
  const needle = sym.replace(/:\d+(-\d+)?$/, "");
  if (app.includes(needle)) ok("G2: app symbol present: " + sym);
  else fail("G2: app symbol missing: " + sym);
}

// ---- G3: negative control — the app lacks the named missing features ----
// Each "Missing" claim names a feature the app should NOT have. We assert the
// absence of a distinctive token. The absence logic is self-tested first.
const KNOWN_PRESENT = "proficiencyBonus"; // must be found
const KNOWN_ABSENT = "hitDie"; // must NOT be found (gap 16)
if (!app.includes(KNOWN_PRESENT)) fail("G3 self-test: known-present symbol not found (logic broken)");
else ok("G3 self-test: known-present symbol found");
if (app.includes(KNOWN_ABSENT)) fail("G3 self-test: known-absent symbol found (absence check broken)");
else ok("G3 self-test: known-absent symbol not found");

// Distinctive tokens that must be ABSENT for the corresponding gap to hold.
const absentChecks = [
  ["hitDie", "gap 16: hit die type/count not tracked"],
  ["spellSlots", "gap 20: spell slots absent"],
  ["spellSaveDC", "gap 21: spell save DC absent"],
  ["spellAttackBonus", "gap 21: spell attack bonus absent"],
  ["concentration", "gap 23: concentration tracking absent"],
  ["carryingCapacity", "gap 30: carrying capacity absent"],
  ["encumbrance", "gap 30: encumbrance absent"],
  ["deathSaves", "gap 34: death saves absent"],
  ["tempHp", "gap 34: temp HP absent"],
  ["coin", "gap 34: coin/wealth tracking absent"],
];
for (const [token, label] of absentChecks) {
  if (app.includes(token)) fail("G3: app HAS " + token + " (" + label + ")");
  else ok("G3: app lacks " + token + " (" + label + ")");
}

// ---- report ----
if (failures.length) {
  console.error("audit verification FAILED:");
  for (const f of failures) console.error("  FAIL " + f);
  process.exit(1);
}
console.log("audit verification passed");
