import { hasKey, prompt, structured } from "./claude.js";
import { Extraction } from "./schemas.js";
import { extractWithGemini } from "./gemini.js";

const SYSTEM = prompt("extract");
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM]))?(?![A-Za-z\d])`;
const WORD_MULT = /^\s*(million|billion|thousand|mm|bn)\b/i;

// $-anchored figure first; bare number only when the string has no "$". Null if a word multiplier follows.
export function parseAmountCents(amountText: string): bigint | null {
  const m = amountText.includes("$")
    ? amountText.match(new RegExp(String.raw`\$\s?` + NUM))
    : amountText.match(new RegExp(NUM));
  if (!m || WORD_MULT.test(amountText.slice(m.index! + m[0].length))) return null;
  const mult = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as "k" | "m"] ?? 1;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? BigInt(Math.round(n * mult * 100)) : null;
}

// Real-model offsets are untrusted: recompute from the quote, drop facts whose quote isn't in the note.
export function normalizeFacts(noteText: string, x: Extraction): Extraction {
  const facts = x.facts.flatMap((f) => {
    const charStart = noteText.indexOf(f.quote);
    return charStart < 0 ? [] : [{ ...f, charStart, charEnd: charStart + f.quote.length }];
  });
  return { ...x, facts };
}

export async function extract(noteText: string, sourceId: number): Promise<Extraction> {
  if (hasKey) return normalizeFacts(noteText, await structured(Extraction, SYSTEM, `<note source_id="${sourceId}">${noteText}</note>`));
  return mockExtract(noteText);
}

export function mockExtract(noteText: string): Extraction {
  // ponytail: deterministic mock only knows the demo's "another $X" ambiguity
  const m = noteText.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/);
  if (/\banother\b/i.test(noteText) && m) {
    const charStart = m.index!, charEnd = charStart + m[0].length;
    return {
      facts: [{ kind: "remaining_update", amountText: m[0], quote: m[0], charStart, charEnd }],
      ambiguity: { flag: true, kind: "additional_vs_total", options: ["additional", "new_total"],
        question: `Is "${m[0]}" added to the current remaining forecast, or is it the new total remaining to finish?` },
    };
  }
  const none = { flag: false, kind: "none" as const, question: "", options: [] };
  const re = noteText.match(/Remaining Estimate:?\s*\$\s?\d[\d,]*(?:\.\d+)?/i);
  if (re) return { facts: [{ kind: "remaining_update", amountText: re[0], quote: re[0], charStart: re.index!, charEnd: re.index! + re[0].length }], ambiguity: none };
  const ms = noteText.match(/\bacceptance\b/i);
  if (ms && /commission|accept(ed|ance) (test|sign)/i.test(noteText)) {
    return { facts: [{ kind: "milestone", amountText: "", quote: ms[0], charStart: ms.index!, charEnd: ms.index! + ms[0].length }], ambiguity: none };
  }
  return { facts: [], ambiguity: none };
}

type Reader = (noteText: string, sourceId: number) => Promise<Extraction>;
export type Both = { claude: Extraction; gemini: Extraction | null; agreed: boolean; merged: Extraction };
const GEMINI_TIMEOUT_MS = 5000;
let warned = false;
const primaryAmount = (x: Extraction) => {
  const f = x.facts.find((f) => f.kind === "remaining_update");
  return f ? parseAmountCents(f.quote) : undefined; // undefined = no fact, null = unparseable
};

// Claude is primary; Gemini is an independent second reader whose failure never blocks the flow.
export async function extractBoth(noteText: string, sourceId: number, readers: { claude: Reader; gemini: Reader } = { claude: extract, gemini: extractWithGemini }): Promise<Both> {
  let timer: NodeJS.Timeout | undefined;
  const second = Promise.race([
    readers.gemini(noteText, sourceId),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("gemini timeout")), GEMINI_TIMEOUT_MS); }),
  ]).catch((e) => {
    if (!warned && e?.message !== "no GEMINI_API_KEY") { warned = true; console.log("second reader unavailable"); } // no key: gemini.ts already logged
    return null;
  }).finally(() => clearTimeout(timer));
  const [claude, gemini] = await Promise.all([readers.claude(noteText, sourceId), second]);
  if (!gemini) return { claude, gemini, agreed: true, merged: claude };
  const a = primaryAmount(claude), b = primaryAmount(gemini);
  if (a === b) {
    // Same amount: only the flag can differ; the flagged reader's question wins (still an ordinary additive question).
    const merged = !claude.ambiguity.flag && gemini.ambiguity.flag ? { ...claude, ambiguity: gemini.ambiguity } : claude;
    return { claude, gemini, agreed: true, merged };
  }
  const show = (v: bigint | null | undefined, x: Extraction) => v === undefined ? "no remaining-forecast update" : v === null ? `"${x.facts.find((f) => f.kind === "remaining_update")!.quote}"` : `$${v / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const bothAmounts = a != null && b != null;
  const merged: Extraction = { ...claude, ambiguity: {
    flag: true, kind: "other",
    question: `Two independent readers disagree on this note: Claude read ${show(a, claude)}${claude.ambiguity.flag ? " (ambiguous)" : ""}, Gemini read ${show(b, gemini)}${gemini.ambiguity.flag ? " (ambiguous)" : ""}. Which is right?`,
    options: bothAmounts ? ["additional", "new_total"] : claude.ambiguity.options,
  } };
  return { claude, gemini, agreed: false, merged };
}
