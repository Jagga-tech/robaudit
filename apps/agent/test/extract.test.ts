import { describe, it, expect } from "vitest";
import { extract, parseAmountCents } from "../src/extract.js";
import { explain } from "../src/explain.js";
import { learnConventions } from "../src/learn.js";
import { hasKey } from "../src/claude.js";

describe("parseAmountCents", () => {
  it.each([
    ["$200,000", 20000000n],
    ["200k", 20000000n],
    ["$1.5M", 150000000n],
    ["50,000", 5000000n],
    ["another $200,000", 20000000n],
    ["two hundred thousand", null],
    ["", null],
  ])("%s -> %s", (t, want) => expect(parseAmountCents(t)).toBe(want));
});

const cases = () => {
  it("flags 'another $200,000' as additional_vs_total", async () => {
    const r = await extract("we need another $200,000 to finish", 1);
    expect(r.ambiguity.flag).toBe(true);
    expect(r.ambiguity.kind).toBe("additional_vs_total");
    expect(r.ambiguity.options).toEqual(["additional", "new_total"]);
    expect(r.facts.some((f) => parseAmountCents(f.amountText) === 20000000n)).toBe(true);
  });
  it("no facts for chit-chat", async () => {
    const r = await extract("Crew on site, weather fine.", 2);
    expect(r.facts.length).toBe(0);
    expect(r.ambiguity.flag).toBe(false);
  });
  it("'new total remaining' is not ambiguous", async () => {
    const r = await extract("the new total remaining is $600,000", 3);
    expect(r.ambiguity.flag).toBe(false);
  });
};

describe.skipIf(hasKey)("extract (mock)", cases);
describe.skipIf(!hasKey)("extract (real API)", cases, 120_000);

describe.skipIf(hasKey)("explain/learn (mock)", () => {
  it("returns MOCK-prefixed strings", async () => {
    const c = { estTotal: 1n, progressBp: 1n, cumRevenue: 1n, contractAsset: 1n, margin: { amount: 1n, bp: 1n, lossWarning: false } };
    const e = await explain({ before: c, after: c, adjustmentCents: 0n, convention: "x", evidence: [] });
    expect(e.summary.startsWith("MOCK:")).toBe(true);
    const l = await learnConventions([{ sourceId: 1, text: "x" }]);
    expect(l.proposals[0].value.startsWith("MOCK:")).toBe(true);
  });
});

describe.skipIf(!hasKey)("explain/learn (real API)", () => {
  it("explain returns three fields", async () => {
    const b = { estTotal: 1000000000n, progressBp: 6000n, cumRevenue: 720000000n, contractAsset: 120000000n, margin: { amount: 200000000n, bp: 1667n, lossWarning: false } };
    const a = { ...b, estTotal: 1020000000n, progressBp: 5882n, cumRevenue: 705840000n, margin: { amount: 180000000n, bp: 1500n, lossWarning: false } };
    const e = await explain({ before: b, after: a, adjustmentCents: 20000000n, convention: "additional", evidence: ["we need another $200,000 to finish"] });
    expect(e.summary.length).toBeGreaterThan(0);
    expect(e.whatDidNotChange.length).toBeGreaterThan(0);
  });
  it("learn proposes conventions", async () => {
    const l = await learnConventions([
      { sourceId: 10, text: "Q1 close: PM's remaining estimate covered future costs only; we added it to costs to date." },
      { sourceId: 11, text: "Q2 close: again treated 'remaining' as costs still to be incurred, excluding spend booked." },
    ]);
    expect(l.proposals.length).toBeGreaterThan(0);
  });
}, 120_000);
