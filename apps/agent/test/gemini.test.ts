import { describe, expect, it, vi } from "vitest";
import { extractBoth } from "../src/extract.js";
import { extractWithGemini } from "../src/gemini.js";
import { handleNewSource, type Deps } from "../src/loop.js";
import { Extraction } from "../src/schemas.js";

const NOTE = "we need another $200,000 to finish";
const none = { flag: false, kind: "none" as const, question: "", options: [] };
const remaining = (amt: string, flag = true): Extraction => ({
  facts: [{ kind: "remaining_update", amountText: amt, quote: amt, charStart: 0, charEnd: amt.length }],
  ambiguity: flag ? { flag, kind: "additional_vs_total", question: "Added or new total?", options: ["additional", "new_total"] } : none,
});
const empty: Extraction = { facts: [], ambiguity: none };

// Readers return nothing actionable, so handleNewSource stops right after recording extractions.
async function runLoop(claude: () => Promise<Extraction>, gemini: () => Promise<Extraction>) {
  const recordExtraction = vi.fn(async () => {});
  const state = { projects: [], sources: [], conventions: [], workItems: [], calculations: [], extractions: [], milestones: [], clarificationRefs: [], proposals: [] };
  const deps = {
    ledger: { state: () => state, recordExtraction },
    extract: claude,
    extractBoth: (t: string, id: number) => extractBoth(t, id, { claude, gemini }),
  } as unknown as Deps;
  await handleNewSource({ id: 5n, projectId: 1n, kind: "note", text: "status update, nothing new" }, deps);
  return recordExtraction.mock.calls.map((c: any[]) => c[0]);
}

describe("gemini second reader", () => {
  it("(1) readers agree -> merged is claude, agreed, two extraction rows", async () => {
    const c = remaining("$200,000");
    const r = await extractBoth(NOTE, 1, { claude: async () => c, gemini: async () => remaining("$200,000") });
    expect(r).toMatchObject({ agreed: true, merged: c });
    expect(r.merged).toBe(c);
    const rows = await runLoop(async () => empty, async () => empty);
    expect(rows.map((x) => x.reader)).toEqual(["claude", "gemini"]);
  });

  it("(2) Gemini reads a different amount -> forced ambiguity naming both", async () => {
    const r = await extractBoth(NOTE, 1, { claude: async () => remaining("$200,000", false), gemini: async () => remaining("$2,000,000", false) });
    expect(r.agreed).toBe(false);
    expect(r.merged.ambiguity).toMatchObject({ flag: true, kind: "other", options: ["additional", "new_total"] });
    expect(r.merged.ambiguity.question).toContain("$200,000");
    expect(r.merged.ambiguity.question).toContain("$2,000,000");
    expect(r.merged.facts).toEqual(r.claude.facts);
  });

  it("(2b) only one reader sees a remaining update -> disagreement, Claude's options kept", async () => {
    const r = await extractBoth(NOTE, 1, { claude: async () => empty, gemini: async () => ({ ...remaining("$200,000"), ambiguity: none }) });
    expect(r.agreed).toBe(false);
    expect(r.merged.ambiguity).toMatchObject({ flag: true, kind: "other", options: [] });
  });

  it("(3) Gemini rejects or times out -> single reader, one extraction row", async () => {
    const rej = await extractBoth(NOTE, 1, { claude: async () => empty, gemini: async () => { throw new Error("boom"); } });
    expect(rej).toMatchObject({ gemini: null, agreed: true, merged: empty });
    vi.useFakeTimers();
    try {
      const p = extractBoth(NOTE, 1, { claude: async () => empty, gemini: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toMatchObject({ gemini: null, agreed: true });
    } finally { vi.useRealTimers(); }
    const rows = await runLoop(async () => empty, async () => { throw new Error("down"); });
    expect(rows.map((x) => x.reader)).toEqual(["claude"]);
  });

  it.skipIf(!!process.env.GEMINI_API_KEY)("(4) mock-mode extractWithGemini returns a valid Extraction", async () => {
    const x = Extraction.parse(await extractWithGemini(NOTE));
    expect(x.ambiguity.flag).toBe(true);
  });
});

describe.skipIf(!process.env.GEMINI_API_KEY)("gemini (real API)", () => {
  it("flags 'another $200,000' as ambiguous", async () => {
    const x = await extractWithGemini(NOTE);
    expect(x.ambiguity.flag).toBe(true);
  }, 30000);
});
